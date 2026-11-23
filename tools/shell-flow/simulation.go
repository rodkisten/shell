//go:build js && wasm

package main

import (
 "encoding/json"
 "math/big"
 "regexp"
 "strconv"
 "strings"

 "mvdan.cc/sh/v3/syntax"
)

// simulation.go deliberately interprets a small, side-effect-free subset.
// Unknown results must never be treated as successful execution.
var variablePattern = regexp.MustCompile(`^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$`)
var testPattern = regexp.MustCompile(`^(.+?)\s+(==|!=|=|-eq|-ne|-gt|-ge|-lt|-le)\s+(.+)$`)
var unaryPattern = regexp.MustCompile(`^(-z|-n)\s+(.+)$`)

func simulationOperand(raw string, variables map[string]json.RawMessage) (string, bool) {
 value := strings.TrimSpace(raw)
 if len(value) >= 2 && ((value[0] == '"' && value[len(value)-1] == '"') || (value[0] == 39 && value[len(value)-1] == 39)) {
  value = value[1:len(value)-1]
 }
 if match := variablePattern.FindStringSubmatch(value); match != nil {
  rawValue, exists := variables[match[1]]
  if !exists { return "", false }
  var text string
  if json.Unmarshal(rawValue, &text) == nil { return text, true }
  return "", false // Arrays cannot be silently coerced into strings.
 }
 if strings.ContainsAny(value, "$\x60") { return "", false }
 return value, true
}

func evaluateTest(source string, variables map[string]json.RawMessage) string {
 text := strings.TrimSpace(source)
 if text == "true" || text == ":" { return "true" }
 if text == "false" { return "false" }
 var body string
 switch {
 case strings.HasPrefix(text, "[[ ") && strings.HasSuffix(text, " ]]"):
  body = strings.TrimSpace(text[3:len(text)-3])
 case strings.HasPrefix(text, "[ ") && strings.HasSuffix(text, " ]"):
  body = strings.TrimSpace(text[2:len(text)-2])
 case strings.HasPrefix(text, "test "):
  body = strings.TrimSpace(text[5:])
 default:
  return "unknown"
 }
 if match := unaryPattern.FindStringSubmatch(body); match != nil {
  value, ok := simulationOperand(match[2], variables)
  if !ok { return "unknown" }
  truth := len(value) == 0
  if match[1] == "-n" { truth = !truth }
  if truth { return "true" }
  return "false"
 }
 match := testPattern.FindStringSubmatch(body)
 if match == nil { return "unknown" }
 left, leftOK := simulationOperand(match[1], variables)
 right, rightOK := simulationOperand(match[3], variables)
 if !leftOK || !rightOK { return "unknown" }
 var truth bool
 switch match[2] {
 case "=", "==": truth = left == right
 case "!=": truth = left != right
 default:
  a, okA := new(big.Int).SetString(left, 10)
  b, okB := new(big.Int).SetString(right, 10)
  if !okA || !okB { return "unknown" }
  cmp := a.Cmp(b)
  switch match[2] {
  case "-eq": truth = cmp == 0
  case "-ne": truth = cmp != 0
  case "-gt": truth = cmp > 0
  case "-ge": truth = cmp >= 0
  case "-lt": truth = cmp < 0
  case "-le": truth = cmp <= 0
  }
 }
 if truth { return "true" }
 return "false"
}

// Environment merging keeps only facts equal across all feasible paths.
type simulationEnv map[string]json.RawMessage

func copySimulationEnv(env simulationEnv) simulationEnv {
 next := make(simulationEnv, len(env))
 for key, value := range env { next[key] = value }
 return next
}

func mergeSimulationEnv(left, right simulationEnv) simulationEnv {
 merged := make(simulationEnv)
 for key, value := range left {
  if other, ok := right[key]; ok && string(value) == string(other) {
   merged[key] = value
  }
 }
 return merged
}

var assignmentPattern = regexp.MustCompile(`^([A-Za-z_][A-Za-z0-9_]*)=(.*)$`)

// Evaluate statements in source order and fork state at conditional branches.
// Unknown conditions merge the states rather than guessing a branch.
func simulateConditions(source string, file *syntax.File, nodes []node, variables map[string]json.RawMessage) map[string]string {
 decisions := make(map[string]string)
 initial := make(simulationEnv, len(variables))
 for key, value := range variables { initial[key] = value }
 // The graph uses the condition statement's offset as its node identity.
 byRange := make(map[string][]string)
 for _, n := range nodes {
  key := strings.Join([]string{strconv.Itoa(n.Start), strconv.Itoa(n.End)}, ":")
  byRange[key] = append(byRange[key], n.ID)
 }
 record := func(stmt *syntax.Stmt, outcome string) {
  if outcome == "unknown" { return }
  key := strings.Join([]string{strconv.Itoa(int(stmt.Pos().Offset())), strconv.Itoa(int(stmt.End().Offset()))}, ":")
  for _, id := range byRange[key] { decisions[id] = outcome }
 }
 var walkList func([]*syntax.Stmt, simulationEnv) simulationEnv
 var walkIf func(*syntax.IfClause, simulationEnv) simulationEnv
 walkIf = func(clause *syntax.IfClause, incoming simulationEnv) simulationEnv {
  conditionEnv := walkList(clause.Cond, incoming)
  outcome := "unknown"
  if len(clause.Cond) > 0 {
   last := clause.Cond[len(clause.Cond)-1]
   a, b := int(last.Pos().Offset()), int(last.End().Offset())
   if a >= 0 && b <= len(source) && a < b {
    outcome = evaluateTest(source[a:b], conditionEnv)
    record(last, outcome)
   }
  }
  thenEnv := copySimulationEnv(conditionEnv)
  elseEnv := copySimulationEnv(conditionEnv)
  if outcome != "false" { thenEnv = walkList(clause.Then, thenEnv) }
  if clause.Else != nil && outcome != "true" {
   if len(clause.Else.Cond) > 0 {
    // Elif is another clause, not a synthetic zero-offset statement.
    elseEnv = walkIf(clause.Else, elseEnv)
   } else { elseEnv = walkList(clause.Else.Then, elseEnv) }
  }
  switch outcome {
  case "true": return thenEnv
  case "false": return elseEnv
  default: return mergeSimulationEnv(thenEnv, elseEnv)
  }
 }
 walkList = func(stmts []*syntax.Stmt, incoming simulationEnv) simulationEnv {
  env := copySimulationEnv(incoming)
  for _, stmt := range stmts {
   start, end := int(stmt.Pos().Offset()), int(stmt.End().Offset())
   if start < 0 || end > len(source) || start >= end { continue }
   if clause, ok := stmt.Cmd.(*syntax.IfClause); ok {
    env = walkIf(clause, env)
    continue
   }
   if call, ok := stmt.Cmd.(*syntax.CallExpr); ok && len(call.Args) == 0 && len(call.Assigns) == 1 && len(stmt.Redirs) == 0 && !stmt.Background && !stmt.Negated {
    if match := assignmentPattern.FindStringSubmatch(strings.TrimSpace(source[start:end])); match != nil {
     if _, supplied := variables[match[1]]; !supplied {
      if value, known := simulationOperand(match[2], env); known {
       encoded, _ := json.Marshal(value)
       env[match[1]] = encoded
      } else { delete(env, match[1]) }
     }
     continue
    }
   }
   // Loop iterations and arbitrary commands can mutate shell state.
   // They are not executed or unrolled. Preserve only user-provided inputs.
   outcome := evaluateTest(source[start:end], env)
   record(stmt, outcome)
   if outcome == "unknown" { env = copySimulationEnv(initial) }
  }
  return env
 }
 walkList(file.Stmts, initial)
 return decisions
}
