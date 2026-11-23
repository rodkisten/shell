//go:build js && wasm

package main

import (
 "encoding/json"
 "math/big"
 "regexp"
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

// The simulation follows top-level statements in source order. Control-flow
// constructs are barriers: their assignments must not leak into later nodes.
// This is intentionally conservative until branch-state merging is supported.
var assignmentPattern = regexp.MustCompile(`^([A-Za-z_][A-Za-z0-9_]*)=(.*)$`)

func simulateConditions(source string, file *syntax.File, nodes []node, variables map[string]json.RawMessage) map[string]string {
 decisions := make(map[string]string)
 environment := make(map[string]json.RawMessage, len(variables))
 for key, value := range variables { environment[key] = value }
 nodeIndex := 0
 for _, stmt := range file.Stmts {
  start, end := int(stmt.Pos().Offset()), int(stmt.End().Offset())
  // Nodes are emitted in traversal order. Evaluate all nodes belonging to
  // this statement against the environment before its side effects.
  for nodeIndex < len(nodes) {
   n := nodes[nodeIndex]
   if n.Start >= end { break }
   nodeIndex++
   if n.Start < start || n.End > len(source) || n.Start >= n.End { continue }
   if n.Kind != "Stmt" && n.Kind != "CallExpr" { continue }
   decision := evaluateTest(strings.TrimSpace(source[n.Start:n.End]), environment)
   if decision != "unknown" { decisions[n.ID] = decision }
  }
  if start < 0 || end > len(source) || start >= end { continue }
  // A plain, standalone assignment is the only statement with a known,
  // unconditional environment update. Never assume command substitutions,
  // function calls, or control-flow branches have run.
  if call, ok := stmt.Cmd.(*syntax.CallExpr); ok && len(call.Args) == 0 && len(call.Assigns) == 1 && len(stmt.Redirs) == 0 && !stmt.Background && !stmt.Negated {
   fragment := strings.TrimSpace(source[start:end])
   if match := assignmentPattern.FindStringSubmatch(fragment); match != nil {
    if _, supplied := variables[match[1]]; !supplied {
     if value, known := simulationOperand(match[2], environment); known {
      encoded, _ := json.Marshal(value)
      environment[match[1]] = encoded
     } else { delete(environment, match[1]) }
    }
    continue
   }
  }
  // Commands may mutate variables through builtins or sourced files.
  // Keep only explicit user overrides after any non-assignment statement.
  environment = make(map[string]json.RawMessage, len(variables))
  for key, value := range variables { environment[key] = value }
 }
 return decisions
}
