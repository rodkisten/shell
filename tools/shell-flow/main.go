//go:build js && wasm

package main

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"mvdan.cc/sh/v3/syntax"
)

type scopedVariable struct {
	Name     string `json:"name"`
	Value    string `json:"value,omitempty"`
	Scope    string `json:"scope"` // "global", "local", "exported"
	ReadOnly bool   `json:"readOnly,omitempty"`
}

// scopeVariables extracts variable declarations and assignments from the AST
// and maps the active variable scope to each CFG node ID.
func scopeVariables(file *syntax.File, nodes []node) map[string][]scopedVariable {
	result := make(map[string][]scopedVariable, len(nodes))
	globalVars := make(map[string]scopedVariable)
	localVars := make(map[string]scopedVariable)
	var funcDepth int

	// Helper to snapshot current visible variables for a given CFG node.
	snapshot := func() []scopedVariable {
		merged := make(map[string]scopedVariable, len(globalVars)+len(localVars))
		for k, v := range globalVars {
			merged[k] = v
		}
		for k, v := range localVars {
			merged[k] = v
		}
		list := make([]scopedVariable, 0, len(merged))
		for _, v := range merged {
			list = append(list, v)
		}
		return list
	}

	// Match AST byte offsets to the nearest enclosing CFG node.
	findNodeID := func(pos, end syntax.Pos) string {
		startOff, endOff := int(pos.Offset()), int(end.Offset())
		for _, n := range nodes {
			if startOff >= n.Start && endOff <= n.End {
				return n.ID
			}
		}
		return ""
	}

	syntax.Walk(file, func(n syntax.Node) bool {
		if n == nil {
			if funcDepth > 0 {
				// Reset function-local scope when exiting a function body.
				localVars = make(map[string]scopedVariable)
				funcDepth--
			}
			return true
		}

		switch x := n.(type) {
		case *syntax.FuncDecl:
			funcDepth++
			localVars = make(map[string]scopedVariable)

		case *syntax.Assign:
			if x.Name == nil {
				break
			}
			name := x.Name.Value
			val := extractWordLiteral(x.Value)
			scope := "global"
			if funcDepth > 0 {
				if existing, ok := localVars[name]; ok {
					scope = existing.Scope
				}
			}
			sv := scopedVariable{Name: name, Value: val, Scope: scope}
			if scope == "local" {
				localVars[name] = sv
			} else {
				globalVars[name] = sv
			}

		case *syntax.DeclClause:
			// Handles local, declare, typeset, export, readonly
			variant := x.Variant.Value
			scope := "global"
			readOnly := variant == "readonly"
			switch variant {
			case "local":
				scope = "local"
			case "export":
				scope = "exported"
			case "declare", "typeset":
				if funcDepth > 0 {
					scope = "local"
				}
			}

			for _, assign := range x.Args {
				if assign.Name == nil {
					continue
				}
				name := assign.Name.Value
				val := extractWordLiteral(assign.Value)
				sv := scopedVariable{
					Name:     name,
					Value:    val,
					Scope:    scope,
					ReadOnly: readOnly,
				}
				if scope == "local" {
					localVars[name] = sv
				} else {
					globalVars[name] = sv
				}
			}
		}

		if id := findNodeID(n.Pos(), n.End()); id != "" {
			result[id] = snapshot()
		}
		return true
	})

	// Ensure every node has a deterministic entry even if no assignments occurred yet.
	for _, n := range nodes {
		if _, exists := result[n.ID]; !exists {
			result[n.ID] = []scopedVariable{}
		}
	}
	return result
}

// simulateConditions statically evaluates test expressions ([ ], [[ ]], test, true/false)
// using provided runtime variables and returns a map of nodeID -> "true" | "false" | "unknown".
func simulateConditions(source string, file *syntax.File, nodes []node, rawVars map[string]json.RawMessage) map[string]string {
	decisions := make(map[string]string)
	env := flattenJSONVars(rawVars)

	// Collect top-level assignments into env as fallback values if not overridden by caller.
	syntax.Walk(file, func(n syntax.Node) bool {
		if assign, ok := n.(*syntax.Assign); ok && assign.Name != nil {
			if _, exists := env[assign.Name.Value]; !exists {
				env[assign.Name.Value] = extractWordLiteral(assign.Value)
			}
		}
		return true
	})

	syntax.Walk(file, func(n syntax.Node) bool {
		stmt, ok := n.(*syntax.Stmt)
		if !ok {
			return true
		}

		var nodeID string
		for _, candidate := range nodes {
			if int(stmt.Pos().Offset()) == candidate.Start && int(stmt.End().Offset()) == candidate.End {
				nodeID = candidate.ID
				break
			}
		}
		if nodeID == "" {
			return true
		}

		outcome := evalStmtCondition(stmt, env)
		if outcome != "" {
			if stmt.Negated {
				switch outcome {
				case "true":
					outcome = "false"
				case "false":
					outcome = "true"
				}
			}
			decisions[nodeID] = outcome
		}
		return true
	})

	return decisions
}

// flowNodeStates propagates reachability from the entry node using resolved decisions.
// Possible states: "reachable", "conditional", "unreachable".
func flowNodeStates(nodes []node, edges []edge, decisions map[string]string) map[string]string {
	states := make(map[string]string, len(nodes))
	for _, n := range nodes {
		states[n.ID] = "unreachable"
	}
	if len(nodes) == 0 {
		return states
	}

	adj := make(map[string][]edge, len(nodes))
	for _, e := range edges {
		adj[e.From] = append(adj[e.From], e)
	}

	type visit struct {
		id          string
		conditional bool
	}

	queue := []visit{{id: nodes[0].ID, conditional: false}}
	// Track best state seen: reachable > conditional > unreachable
	rank := map[string]int{"unreachable": 0, "conditional": 1, "reachable": 2}

	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]

		nextState := "reachable"
		if curr.conditional {
			nextState = "conditional"
		}
		if rank[nextState] <= rank[states[curr.id]] {
			continue
		}
		states[curr.id] = nextState

		decision := decisions[curr.id] // "", "true", "false", or "unknown"

		for _, e := range adj[curr.id] {
			edgeCond := curr.conditional

			switch e.Kind {
			case "true", "false":
				if decision == "true" || decision == "false" {
					// Prune the untaken branch when static evaluation is conclusive.
					if e.Kind != decision {
						continue
					}
				} else {
					// Branch outcome is unknown at static analysis time.
					edgeCond = true
				}
			case "unknown":
				edgeCond = true
			}

			queue = append(queue, visit{id: e.To, conditional: edgeCond})
		}
	}

	return states
}

// --- Internal Helpers ---

func flattenJSONVars(raw map[string]json.RawMessage) map[string]string {
	out := make(map[string]string, len(raw))
	for k, v := range raw {
		var str string
		if err := json.Unmarshal(v, &str); err == nil {
			out[k] = str
			continue
		}
		var num float64
		if err := json.Unmarshal(v, &num); err == nil {
			out[k] = strconv.FormatFloat(num, 'f', -1, 64)
			continue
		}
		var b bool
		if err := json.Unmarshal(v, &b); err == nil {
			out[k] = strconv.FormatBool(b)
			continue
		}
		out[k] = strings.Trim(string(v), `"`)
	}
	return out
}

func extractWordLiteral(w *syntax.Word) string {
	if w == nil {
		return ""
	}
	var sb strings.Builder
	for _, part := range w.Parts {
		switch p := part.(type) {
		case *syntax.Lit:
			sb.WriteString(p.Value)
		case *syntax.SglQuoted:
			sb.WriteString(p.Value)
		case *syntax.DblQuoted:
			for _, inner := range p.Parts {
				if lit, ok := inner.(*syntax.Lit); ok {
					sb.WriteString(lit.Value)
				}
			}
		}
	}
	return sb.String()
}

func resolveWord(w *syntax.Word, env map[string]string) (string, bool) {
	if w == nil {
		return "", true
	}
	var sb strings.Builder
	for _, part := range w.Parts {
		switch p := part.(type) {
		case *syntax.Lit:
			sb.WriteString(p.Value)
		case *syntax.SglQuoted:
			sb.WriteString(p.Value)
		case *syntax.ParamExp:
			val, ok := env[p.Param.Value]
			if !ok {
				return "", false
			}
			sb.WriteString(val)
		case *syntax.DblQuoted:
			for _, inner := range p.Parts {
				switch ip := inner.(type) {
				case *syntax.Lit:
					sb.WriteString(ip.Value)
				case *syntax.ParamExp:
					val, ok := env[ip.Param.Value]
					if !ok {
						return "", false
					}
					sb.WriteString(val)
				default:
					return "", false
				}
			}
		default:
			return "", false
		}
	}
	return sb.String(), true
}

func evalStmtCondition(stmt *syntax.Stmt, env map[string]string) string {
	switch cmd := stmt.Cmd.(type) {
	case *syntax.TestClause:
		return evalTestExpr(cmd.X, env)

	case *syntax.CallExpr:
		if len(cmd.Args) == 0 {
			return ""
		}
		name, ok := resolveWord(cmd.Args[0], env)
		if !ok {
			return "unknown"
		}
		switch name {
		case "true", ":":
			return "true"
		case "false":
			return "false"
		case "[", "test":
			args := cmd.Args[1:]
			if name == "[" && len(args) > 0 {
				last, _ := resolveWord(args[len(args)-1], env)
				if last == "]" {
					args = args[:len(args)-1]
				}
			}
			return evalBracketArgs(args, env)
		}
	}
	return ""
}

func evalTestExpr(expr syntax.TestExpr, env map[string]string) string {
	switch e := expr.(type) {
	case *syntax.ParenTest:
		return evalTestExpr(e.X, env)
	case *syntax.UnaryTest:
		val, ok := resolveWord(e.X, env)
		if !ok {
			return "unknown"
		}
		switch e.Op {
		case syntax.TsNot:
			res := evalTestExpr(e.X, env)
			if res == "true" {
				return "false"
			}
			if res == "false" {
				return "true"
			}
			return "unknown"
		case syntax.TsEmpStr: // -z
			return boolToDecision(val == "")
		case syntax.TsNempStr: // -n
			return boolToDecision(val != "")
		default:
			// File-system tests (-f, -d, -e, etc.) cannot be resolved statically
			return "unknown"
		}
	case *syntax.BinaryTest:
		if e.Op == syntax.AndTest || e.Op == syntax.OrTest {
			left := evalTestExpr(e.X, env)
			right := evalTestExpr(e.Y, env)
			if e.Op == syntax.AndTest {
				if left == "false" || right == "false" {
					return "false"
				}
				if left == "true" && right == "true" {
					return "true"
				}
				return "unknown"
			}
			if left == "true" || right == "true" {
				return "true"
			}
			if left == "false" && right == "false" {
				return "false"
			}
			return "unknown"
		}

		lhs, okL := resolveWord(e.X, env)
		rhs, okR := resolveWord(e.Y, env)
		if !okL || !okR {
			return "unknown"
		}
		return compareBinary(e.Op.String(), lhs, rhs)
	}
	return "unknown"
}

func evalBracketArgs(args []*syntax.Word, env map[string]string) string {
	switch len(args) {
	case 0:
		return "false"
	case 1:
		val, ok := resolveWord(args[0], env)
		if !ok {
			return "unknown"
		}
		return boolToDecision(val != "")
	case 2:
		op, okOp := resolveWord(args[0], env)
		val, okVal := resolveWord(args[1], env)
		if !okOp || !okVal {
			return "unknown"
		}
		switch op {
		case "-z":
			return boolToDecision(val == "")
		case "-n":
			return boolToDecision(val != "")
		default:
			return "unknown"
		}
	case 3:
		lhs, okL := resolveWord(args[0], env)
		op, okOp := resolveWord(args[1], env)
		rhs, okR := resolveWord(args[2], env)
		if !okL || !okOp || !okR {
			return "unknown"
		}
		return compareBinary(op, lhs, rhs)
	}
	return "unknown"
}

func compareBinary(op, lhs, rhs string) string {
	switch op {
	case "=", "==":
		return boolToDecision(lhs == rhs)
	case "!=":
		return boolToDecision(lhs != rhs)
	case "<":
		return boolToDecision(lhs < rhs)
	case ">":
		return boolToDecision(lhs > rhs)
	case "-eq", "-ne", "-lt", "-le", "-gt", "-ge":
		lNum, errL := strconv.Atoi(strings.TrimSpace(lhs))
		rNum, errR := strconv.Atoi(strings.TrimSpace(rhs))
		if errL != nil || errR != nil {
			return "unknown"
		}
		switch op {
		case "-eq":
			return boolToDecision(lNum == rNum)
		case "-ne":
			return boolToDecision(lNum != rNum)
		case "-lt":
			return boolToDecision(lNum < rNum)
		case "-le":
			return boolToDecision(lNum <= rNum)
		case "-gt":
			return boolToDecision(lNum > rNum)
		case "-ge":
			return boolToDecision(lNum >= rNum)
		}
	}
	return "unknown"
}

func boolToDecision(b bool) string {
	if b {
		return "true"
	}
	return "false"
}
