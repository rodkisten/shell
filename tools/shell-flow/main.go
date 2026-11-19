//go:build js && wasm

package main

import (
 "encoding/json"
 "fmt"
 "syscall/js"
 "mvdan.cc/sh/v3/syntax"
)

type node struct { ID string `json:"id"`; Kind string `json:"kind"`; Start int `json:"start"`; End int `json:"end"` }
type edge struct { From string `json:"from"`; To string `json:"to"`; Kind string `json:"kind"` }
type result struct { Nodes []node `json:"nodes"`; Edges []edge `json:"edges"`; Warnings []string `json:"warnings"` }
func main() {
 callback := js.FuncOf(func(this js.Value, args []js.Value) any {
  if len(args)==0 { return errorJSON(fmt.Errorf("missing source")) }
  source:=args[0].String()
  file,err:=syntax.NewParser(syntax.Variant(syntax.LangBash),syntax.KeepComments(true)).Parse(stringsReader(source),"script.sh")
  if err!=nil {return errorJSON(err)}
  out:=result{Nodes:[]node{},Edges:[]edge{},Warnings:[]string{"Static syntax graph; not an observed runtime trace.","Bash parser mode; Zsh-specific syntax may be unsupported."}}
  var prev string
  for i,stmt:=range file.Stmts {
   id:=fmt.Sprintf("stmt-%d",i)
   out.Nodes=append(out.Nodes,node{ID:id,Kind:"Stmt",Start:int(stmt.Pos().Offset()),End:int(stmt.End().Offset())})
   if prev!="" {out.Edges=append(out.Edges,edge{From:prev,To:id,Kind:"next"})}
   prev=id
  }
  data,err:=json.Marshal(out);if err!=nil{return errorJSON(err)}
  return string(data)
 })
 js.Global().Set("shellFlowAnalyze",callback)
 select{}
}
func errorJSON(err error) string { b,_:=json.Marshal(map[string]string{"error":err.Error()});return string(b) }
