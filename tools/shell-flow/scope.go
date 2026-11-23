//go:build js && wasm

package main

import (
	"encoding/json"
	"fmt"
	"path"
	"strconv"
	"strings"

	"mvdan.cc/sh/v3/syntax"
)

// simulateConditions statically evaluates test expressions ([ ], [[ ]], test, true/false)
// and CaseClause patterns using provided runtime variables and conservative script-level defaults.
func simulateConditions(source string, file *syntax.File, nodes []node, rawVars map[string]json.RawMessage) map[string]string {
	decisions := make(map[string]string)
	explicitEnv := flattenJSONVars(rawVars)

	syntax.Walk(file, func(n syntax.Node) bool {
		stmt, ok := n.(*syntax.Stmt)
		if !ok || stmt.Cmd == nil {
			return true
		}

		if caseCmd, isCase := stmt.Cmd.(*syntax.CaseClause); isCase {
			endPos := caseCmd.In
			if !endPos.IsValid() {
				endPos = caseCmd.End()
			}
			nodeID := findExactNode(nodes, caseCmd.Pos(), endPos)
			if nodeID != "" {
				env := buildEnvBeforeOffset(file, int(caseCmd.Pos().Offset()), explicitEnv)
				decisions[nodeID] = evalCaseClause(caseCmd, env)
			}
			return true
		}

		nodeID := findExactNode(nodes, stmt.Pos(), stmt.End())
		if nodeID == "" {
			return true
		}

		env := buildEnvBeforeOffset(file, int(stmt.Pos().Offset()), explicitEnv)
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

		decision := decisions[curr.id]

		for _, e := range adj[curr.id] {
			edgeCond := curr.conditional

			switch {
			case e.Kind == "true" || e.Kind == "false":
				if decision == "true" || decision == "false" {
					if e.Kind != decision {
						continue
					}
				} else {
					edgeCond = true
				}

			case strings.HasPrefix(e.Kind, "case:"):
				if strings.HasPrefix(decision, "case:") {
					if e.Kind != decision {
						continue
					}
				} else {
					edgeCond = true
				}

			case e.Kind == "unknown":
				edgeCond = true
			}

			queue = append(queue, visit{id: e.To, conditional: edgeCond})
		}
	}

	return states
}

// --- Internal Helpers ---

// buildEnvBeforeOffset collects unconditional top-level assignments occurring strictly before targetOffset,
// overlaid with explicit runtime variables provided by the caller.
func buildEnvBeforeOffset(file *syntax.File, targetOffset int, explicit map[string]string) map[string]string {
	env := make(map[string]string, len(explicit))

	syntax.Walk(file, func(n syntax.Node) bool {
		stmt, ok := n.(*syntax.Stmt)
		if !ok || int(stmt.Pos().Offset()) >= targetOffset {
			return true
		}
		call, ok := stmt.Cmd.(*syntax.CallExpr)
		if !ok || len(call.Args) > 0 || len(call.Assigns) == 0 {
			return true
		}

		uncertain := false
		syntax.Walk(file, func(parent syntax.Node) bool {
			if parent == nil {
				return true
			}
			if parent.Pos().Offset() > stmt.Pos().Offset() || parent.End().Offset() < stmt.End().Offset() {
				return true
			}
			switch parent.(type) {
			case *syntax.IfClause, *syntax.ForClause, *syntax.WhileClause, *syntax.CaseClause, *syntax.BinaryCmd, *syntax.CmdSubst, *syntax.Subshell, *syntax.FuncDecl:
				uncertain = true
			}
			return true
		})
		if uncertain {
			return true
		}

		for _, assign := range call.Assigns {
			if assign.Name == nil || assign.Value == nil {
				continue
			}
			if val, ok := extractLiteral(assign.Value); ok {
				env[assign.Name.Value] = val
			}
		}
		return true
	})

	for k, v := range explicit {
		env[k] = v
	}
	return env
}

func extractLiteral(w *syntax.Word) (string, bool) {
	if w == nil {
		return "", true
	}
	var value strings.Builder
	for _, part := range w.Parts {
		switch p := part.(type) {
		case *syntax.Lit:
			value.WriteString(p.Value)
		case *syntax.SglQuoted:
			value.WriteString(p.Value)
		case *syntax.DblQuoted:
			for _, inner := range p.Parts {
				lit, ok := inner.(*syntax.Lit)
				if !ok {
					return "", false
				}
				value.WriteString(lit.Value)
			}
		default:
			return "", false
		}
	}
	return value.String(), true
}

func findExactNode(nodes []node, pos, end syntax.Pos) string {
	startOff, endOff := int(pos.Offset()), int(end.Offset())
	for _, candidate := range nodes {
		if startOff == candidate.Start && endOff == candidate.End {
			return candidate.ID
		}
	}
	return ""
}

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

func evalCaseClause(clause *syntax.CaseClause, env map[string]string) string {
	subject, ok := resolveWord(clause.Word, env)
	if !ok {
		return "unknown"
	}

	for i, item := range clause.Items {
		matched, resolved := matchCaseItem(subject, item.Patterns, env)
		if !resolved {
			return "unknown"
		}
		if matched {
			return fmt.Sprintf("case:%d", i)
		}
	}

	return "case:none"
}

func matchCaseItem(subject string, patterns []*syntax.Word, env map[string]string) (matched bool, resolved bool) {
	for _, patWord := range patterns {
		patStr, ok := resolveWord(patWord, env)
		if !ok {
			return false, false
		}
		if patStr == "*" {
			return true, true
		}
		okMatch, err := path.Match(patStr, subject)
		if err == nil && okMatch {
			return true, true
		}
	}
	return false, true
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
