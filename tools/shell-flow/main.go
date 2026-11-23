//go:build js && wasm

package main

import (
 "encoding/json"
 "fmt"
 "strings"
 "syscall/js"

 "mvdan.cc/sh/v3/syntax"
)

type node struct { ID string `json:"id"`; Kind string `json:"kind"`; Start int `json:"start"`; End int `json:"end"` }
type edge struct { From string `json:"from"`; To string `json:"to"`; Kind string `json:"kind"` }
type result struct { Nodes []node `json:"nodes"`; Edges []edge `json:"edges"`; Warnings []string `json:"warnings"`; Decisions map[string]string `json:"decisions,omitempty"`; Reachable map[string]bool `json:"reachable,omitempty"` }

func analyze(source string, variables map[string]json.RawMessage) (result, error) {
 file, err := syntax.NewParser(syntax.Variant(syntax.LangBash), syntax.KeepComments(true)).Parse(strings.NewReader(source), "script.sh")
 if err != nil { return result{}, err }
 out := result{Nodes: []node{}, Edges: []edge{}, Warnings: []string{
  "Static control-flow approximation; not an observed runtime trace.",
  "Bash parser mode; Zsh-specific syntax may be unsupported.",
 }}
 var sequence int
 add := func(kind string, pos, end syntax.Pos) string {
  id := fmt.Sprintf("node-%d", sequence)
  sequence++
  out.Nodes = append(out.Nodes, node{ID:id, Kind:kind, Start:int(pos.Offset()), End:int(end.Offset())})
  return id
 }
 connect := func(from, to, kind string) {
  if from != "" && to != "" { out.Edges = append(out.Edges, edge{From:from, To:to, Kind:kind}) }
 }
 // Exit labels represent the condition on the edge to the next node.
 type exit struct { id, kind string }
 var walkStmt func(*syntax.Stmt) (string, []exit)
 var walkIf func(*syntax.IfClause) (string, []exit)
 var walkList func([]*syntax.Stmt) (string, []exit)
 walkList = func(stmts []*syntax.Stmt) (string, []exit) {
  var first string
  var previous []exit
  for _, stmt := range stmts {
   entry, exits := walkStmt(stmt)
   if first == "" { first = entry }
   for _, e := range previous { connect(e.id, entry, e.kind) }
   previous = exits
  }
  return first, previous
 }
 walkStmt = func(stmt *syntax.Stmt) (string, []exit) {
  if binary, ok := stmt.Cmd.(*syntax.BinaryCmd); ok {
   left, leftExits := walkStmt(binary.X)
   right, rightExits := walkStmt(binary.Y)
   switch binary.Op.String() {
   case "&&", "||":
    condition, bypass := "true", "false"
    if binary.Op.String() == "||" { condition, bypass = bypass, condition }
    for _, e := range leftExits { connect(e.id, right, condition) }
    exits := append([]exit{}, rightExits...)
    for _, e := range leftExits { exits = append(exits, exit{e.id, bypass}) }
    return left, exits
   case "|", "|&":
    for _, e := range leftExits { connect(e.id, right, "pipeline") }
    return left, rightExits
   }
  }
  if clause, ok := stmt.Cmd.(*syntax.IfClause); ok {
   return walkIf(clause)
  }
  id := add("Stmt", stmt.Pos(), stmt.End())
  return id, []exit{{id, "next"}}
 }
 walkIf = func(clause *syntax.IfClause) (string, []exit) {
  condEntry, condExits := walkList(clause.Cond)
  if condEntry == "" {
   id := add("IfClause", clause.Pos(), clause.End())
   return id, []exit{{id, "unknown"}}
  }
  thenEntry, thenExits := walkList(clause.Then)
  exits := append([]exit{}, thenExits...)
  if thenEntry != "" {
   for _, e := range condExits { connect(e.id, thenEntry, "true") }
  } else {
   for _, e := range condExits { exits = append(exits, exit{e.id, "true"}) }
  }
  if clause.Else != nil {
   var elseEntry string
   var elseExits []exit
   if len(clause.Else.Cond) > 0 {
    elseEntry, elseExits = walkIf(clause.Else)
   } else {
    elseEntry, elseExits = walkList(clause.Else.Then)
   }
   if elseEntry != "" {
    for _, e := range condExits { connect(e.id, elseEntry, "false") }
    exits = append(exits, elseExits...)
   } else {
    for _, e := range condExits { exits = append(exits, exit{e.id, "false"}) }
   }
  } else {
   for _, e := range condExits { exits = append(exits, exit{e.id, "false"}) }
  }
  return condEntry, exits
 }
 _, _ = walkList(file.Stmts)
 out.Decisions = simulateConditions(source, file, out.Nodes, variables)
 out.Reachable = reachableFlowNodes(out.Nodes, out.Edges, out.Decisions)
 return out, nil
}

func main() {
 callback := js.FuncOf(func(this js.Value, args []js.Value) any {
  if len(args) == 0 { return errorJSON(fmt.Errorf("missing source")) }
  variables := map[string]json.RawMessage{}
  if len(args) > 1 && args[1].Type() == js.TypeString {
   if err := json.Unmarshal([]byte(args[1].String()), &variables); err != nil { return errorJSON(err) }
  }
  out, err := analyze(args[0].String(), variables)
  if err != nil { return errorJSON(err) }
  data, err := json.Marshal(out)
  if err != nil { return errorJSON(err) }
  return string(data)
 })
 js.Global().Set("shellFlowAnalyze", callback)
 select {}
}
func errorJSON(err error) string {
 data, _ := json.Marshal(map[string]string{"error":err.Error()})
 return string(data)
}
