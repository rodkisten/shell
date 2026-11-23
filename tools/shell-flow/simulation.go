//go:build js && wasm

package main

import (
 "encoding/json"
 "math/big"
 "regexp"
 "strings"
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

func simulateConditions(source string, nodes []node, variables map[string]json.RawMessage) map[string]string {
 decisions := make(map[string]string)
 for _, n := range nodes {
  if n.Start < 0 || n.End > len(source) || n.Start >= n.End { continue }
  fragment := strings.TrimSpace(source[n.Start:n.End])
  if n.Kind == "Stmt" || n.Kind == "CallExpr" {
   decision := evaluateTest(fragment, variables)
   if decision != "unknown" { decisions[n.ID] = decision }
  }
 }
 return decisions
}
