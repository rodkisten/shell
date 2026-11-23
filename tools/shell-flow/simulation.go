//go:build js && wasm

package main

import (
	"encoding/json"
	"fmt"
	"path"
	"regexp"
	"strconv"
	"strings"

	"mvdan.cc/sh/v3/syntax"
)

type simVal struct {
	scalar string
	array  []string
	isArr  bool
}

func (v simVal) asScalar() (string, bool) {
	if v.isArr {
		return "", false
	}
	return v.scalar, true
}

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

func buildEnvBeforeOffset(file *syntax.File, targetOffset int, explicit map[string]simVal) map[string]simVal {
	env := make(map[string]simVal, len(explicit))

	syntax.Walk(file, func(n syntax.Node) bool {
		stmt, ok := n.(*syntax.Stmt)
		if !ok || int(stmt.Pos().Offset()) >= targetOffset {
			return true
		}

		var assigns []*syntax.Assign
		switch cmd := stmt.Cmd.(type) {
		case *syntax.CallExpr:
			if len(cmd.Args) == 0 && len(cmd.Assigns) > 0 {
				assigns = cmd.Assigns
			}
		case *syntax.DeclClause:
			assigns = cmd.Args
		}
		if len(assigns) == 0 {
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

		for _, assign := range assigns {
			if assign.Name == nil {
				continue
			}
			if assign.Array != nil {
				var items []string
				allLit := true
				for _, elem := range assign.Array.Elems {
					if elem.Index != nil {
						allLit = false
						break
					}
					if val, ok := extractLiteral(elem.Value); ok {
						items = append(items, val)
					} else {
						allLit = false
						break
					}
				}
				if allLit {
					if assign.Append && env[assign.Name.Value].isArr {
						env[assign.Name.Value] = simVal{array: append(env[assign.Name.Value].array, items...), isArr: true}
					} else {
						env[assign.Name.Value] = simVal{array: items, isArr: true}
					}
				}
				continue
			}
			if assign.Value != nil {
				if val, ok := extractLiteral(assign.Value); ok {
					if assign.Append {
						prev := env[assign.Name.Value].scalar
						env[assign.Name.Value] = simVal{scalar: prev + val}
					} else {
						env[assign.Name.Value] = simVal{scalar: val}
					}
				}
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

func flattenJSONVars(raw map[string]json.RawMessage) map[string]simVal {
	out := make(map[string]simVal, len(raw))
	for k, v := range raw {
		var arr []string
		if err := json.Unmarshal(v, &arr); err == nil {
			out[k] = simVal{array: arr, isArr: true}
			continue
		}
		var str string
		if err := json.Unmarshal(v, &str); err == nil {
			out[k] = simVal{scalar: str}
			continue
		}
		var num float64
		if err := json.Unmarshal(v, &num); err == nil {
			out[k] = simVal{scalar: strconv.FormatFloat(num, 'f', -1, 64)}
			continue
		}
		var b bool
		if err := json.Unmarshal(v, &b); err == nil {
			out[k] = simVal{scalar: strconv.FormatBool(b)}
			continue
		}
		out[k] = simVal{scalar: strings.Trim(string(v), `"`)}
	}
	return out
}

func resolveParamExp(pe *syntax.ParamExp, env map[string]simVal) (string, bool) {
	if pe == nil || pe.Param == nil {
		return "", false
	}
	name := pe.Param.Value
	entry, exists := env[name]

	// Indexação de array: ${ARR[0]} ou ${#ARR[@]}
	if pe.Index != nil {
		if !exists || !entry.isArr {
			return "", false
		}
		if word, ok := pe.Index.(*syntax.Word); ok {
			idxStr, okIdx := resolveWord(word, env)
			if !okIdx {
				return "", false
			}
			if (idxStr == "@" || idxStr == "*") && pe.Length {
				return strconv.Itoa(len(entry.array)), true
			}
			if idx, err := strconv.Atoi(strings.TrimSpace(idxStr)); err == nil {
				if idx < 0 {
					idx = len(entry.array) + idx
				}
				if idx >= 0 && idx < len(entry.array) {
					if pe.Length {
						return strconv.Itoa(len([]rune(entry.array[idx]))), true
					}
					return entry.array[idx], true
				}
				return "", true
			}
		}
		return "", false
	}

	if pe.Length {
		if !exists {
			return "", false
		}
		if entry.isArr {
			if len(entry.array) == 0 {
				return "0", true
			}
			return strconv.Itoa(len([]rune(entry.array[0]))), true
		}
		return strconv.Itoa(len([]rune(entry.scalar))), true
	}

	if entry.isArr {
		return "", false
	}

	val := entry.scalar
	if pe.Exp != nil {
		op := pe.Exp.Op.String()
		argVal, argOK := resolveWord(pe.Exp.Word, env)
		switch op {
		case ":-", ":=":
			if exists && val != "" {
				return val, true
			}
			return argVal, argOK
		case "-", "=":
			if exists {
				return val, true
			}
			return argVal, argOK
		case ":+":
			if exists && val != "" {
				return argVal, argOK
			}
			return "", true
		case "+":
			if exists {
				return argVal, argOK
			}
			return "", true
		}
	}

	if !exists {
		return "", false
	}
	return val, true
}

func resolveWord(w *syntax.Word, env map[string]simVal) (string, bool) {
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
			val, ok := resolveParamExp(p, env)
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
					val, ok := resolveParamExp(ip, env)
					if !ok {
						return "", false
					}
					sb.WriteString(val)
				default:
					return "", false
				}
			}
		case *syntax.ArithmExp:
			res, ok := evalArithmValue(p.X, env)
			if !ok {
				return "", false
			}
			sb.WriteString(strconv.Itoa(res))
		default:
			return "", false
		}
	}
	return sb.String(), true
}

func evalCaseClause(clause *syntax.CaseClause, env map[string]simVal) string {
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

func matchCaseItem(subject string, patterns []*syntax.Word, env map[string]simVal) (matched bool, resolved bool) {
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

func evalStmtCondition(stmt *syntax.Stmt, env map[string]simVal) string {
	switch cmd := stmt.Cmd.(type) {
	case *syntax.TestClause:
		return evalTestExpr(cmd.X, env)

	case *syntax.ArithmCmd:
		val, ok := evalArithmValue(cmd.X, env)
		if !ok {
			return "unknown"
		}
		return boolToDecision(val != 0)

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

// resolveTestWord safely narrows a test expression to a literal shell word.
// Compound expressions are handled by evalTestExpr and must not be treated as words.
func resolveTestWord(expr syntax.TestExpr, env map[string]simVal) (string, bool) {
 word, ok := expr.(*syntax.Word)
 if !ok { return "", false }
 return resolveWord(word, env)
}

func evalTestExpr(expr syntax.TestExpr, env map[string]simVal) string {
	switch e := expr.(type) {
	case *syntax.ParenTest:
		return evalTestExpr(e.X, env)

	case *syntax.UnaryTest:
		if e.Op == syntax.TsNot {
			res := evalTestExpr(e.X, env)
			if res == "true" {
				return "false"
			}
			if res == "false" {
				return "true"
			}
			return "unknown"
		}
		val, ok := resolveTestWord(e.X, env)
		if !ok {
			return "unknown"
		}
		switch e.Op {
		case syntax.TsEmpStr:
			return boolToDecision(val == "")
		case syntax.TsNempStr:
			return boolToDecision(val != "")
		case syntax.TsVarSet:
			_, exists := env[val]
			return boolToDecision(exists)
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

		lhs, okL := resolveTestWord(e.X, env)
		rhs, okR := resolveTestWord(e.Y, env)
		if !okL || !okR {
			return "unknown"
		}

		opStr := e.Op.String()
		if opStr == "=~" {
			re, err := regexp.Compile(rhs)
			if err != nil {
				return "unknown"
			}
			return boolToDecision(re.MatchString(lhs))
		}
		if (opStr == "==" || opStr == "=") && strings.ContainsAny(rhs, "*?[") {
			okMatch, err := path.Match(rhs, lhs)
			if err == nil {
				return boolToDecision(okMatch)
			}
		}
		if opStr == "!=" && strings.ContainsAny(rhs, "*?[") {
			okMatch, err := path.Match(rhs, lhs)
			if err == nil {
				return boolToDecision(!okMatch)
			}
		}

		return compareBinary(opStr, lhs, rhs)
	}
	return "unknown"
}

func evalBracketArgs(args []*syntax.Word, env map[string]simVal) string {
	if len(args) == 0 {
		return "false"
	}

	first, okFirst := resolveWord(args[0], env)
	if okFirst && first == "!" && len(args) > 1 {
		sub := evalBracketArgs(args[1:], env)
		if sub == "true" {
			return "false"
		}
		if sub == "false" {
			return "true"
		}
		return "unknown"
	}

	for i, arg := range args {
		tok, ok := resolveWord(arg, env)
		if !ok {
			continue
		}
		if tok == "-o" && i > 0 && i < len(args)-1 {
			l := evalBracketArgs(args[:i], env)
			r := evalBracketArgs(args[i+1:], env)
			if l == "true" || r == "true" {
				return "true"
			}
			if l == "false" && r == "false" {
				return "false"
			}
			return "unknown"
		}
		if tok == "-a" && i > 0 && i < len(args)-1 {
			l := evalBracketArgs(args[:i], env)
			r := evalBracketArgs(args[i+1:], env)
			if l == "false" || r == "false" {
				return "false"
			}
			if l == "true" && r == "true" {
				return "true"
			}
			return "unknown"
		}
	}

	switch len(args) {
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
		case "-v":
			_, exists := env[val]
			return boolToDecision(exists)
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

func evalArithmValue(expr syntax.ArithmExpr, env map[string]simVal) (int, bool) {
	switch e := expr.(type) {
	case *syntax.ParenArithm:
		return evalArithmValue(e.X, env)
	case *syntax.Word:
		str, ok := resolveWord(e, env)
		if !ok {
			return 0, false
		}
		str = strings.TrimSpace(str)
		if num, err := strconv.Atoi(str); err == nil {
			return num, true
		}
		if entry, exists := env[str]; exists && !entry.isArr {
			if num, err := strconv.Atoi(strings.TrimSpace(entry.scalar)); err == nil {
				return num, true
			}
		}
		return 0, false
	case *syntax.UnaryArithm:
		val, ok := evalArithmValue(e.X, env)
		if !ok {
			return 0, false
		}
		switch e.Op.String() {
		case "+":
			return val, true
		case "-":
			return -val, true
		case "!":
			if val == 0 {
				return 1, true
			}
			return 0, true
		}
	case *syntax.BinaryArithm:
		l, okL := evalArithmValue(e.X, env)
		r, okR := evalArithmValue(e.Y, env)
		if !okL || !okR {
			return 0, false
		}
		switch e.Op.String() {
		case "+":
			return l + r, true
		case "-":
			return l - r, true
		case "*":
			return l * r, true
		case "/":
			if r == 0 {
				return 0, false
			}
			return l / r, true
		case "%":
			if r == 0 {
				return 0, false
			}
			return l % r, true
		case "==":
			return boolToInt(l == r), true
		case "!=":
			return boolToInt(l != r), true
		case "<":
			return boolToInt(l < r), true
		case "<=":
			return boolToInt(l <= r), true
		case ">":
			return boolToInt(l > r), true
		case ">=":
			return boolToInt(l >= r), true
		case "&&":
			return boolToInt(l != 0 && r != 0), true
		case "||":
			return boolToInt(l != 0 || r != 0), true
		}
	}
	return 0, false
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

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
