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
type result struct { Nodes []node `json:"nodes"`; Edges []edge `json:"edges"`; Warnings []string `json:"warnings"` }

func analyze(source string) (result, error) {
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
 // Return entry and all possible exits. An exit's label indicates the
 // condition required before the next statement can execute.
 type exit struct { id, kind string }
 var walkStmt func(*syntax.Stmt) (string, []exit)
 walkStmt = func(stmt *syntax.Stmt) (string, []exit) {
  if binary, ok := stmt.Cmd.(*syntax.BinaryCmd); ok {
   left, leftExits := walkStmt(binary.X)
   right, rightExits := walkStmt(binary.Y)
   op := binary.Op.String()
   switch op {
   case "&&", "||":
    condition := "true"
    bypass := "false"
    if op == "||" { condition, bypass = bypass, condition }
    for _, e := range leftExits { connect(e.id, right, condition) }
    exits := append([]exit{}, rightExits...)
    for _, e := range leftExits { exits = append(exits, exit{e.id, bypass}) }
    return left, exits
   case "|", "|&":
    for _, e := range leftExits { connect(e.id, right, "pipeline") }
    return left, rightExits
   }
  }
  id := add("Stmt", stmt.Pos(), stmt.End())
  return id, []exit{{id, "next"}}
 }
 var previous []exit
 for _, stmt := range file.Stmts {
  entry, exits := walkStmt(stmt)
  for _, e := range previous { connect(e.id, entry, e.kind) }
  previous = exits
 }
 return out, nil
}

func main() {
 callback := js.FuncOf(func(this js.Value, args []js.Value) any {
  if len(args) == 0 { return errorJSON(fmt.Errorf("missing source")) }
  out, err := analyze(args[0].String())
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
