//go:build js && wasm

package main

import (
 "strings"

 "mvdan.cc/sh/v3/syntax"
)

// scopedVariable is a conservative AST-backed definition candidate.
// Unknown values remain unknown; shell commands are never executed.
type scopedVariable struct {
 Name string `json:"name"`
 Value *string `json:"value"`
 Offset int `json:"offset"`
 End int `json:"end"`
 Line int `json:"line"`
 Scope string `json:"scope"`
}

func scopeVariables(file *syntax.File, nodes []node) map[string][]scopedVariable {
 result := make(map[string][]scopedVariable, len(nodes))
 for _, target := range nodes {
  // Track the syntactic ancestry of the selected node. Definitions from
  // unrelated function bodies and subshells must not escape their scope.
  var scopes []syntax.Node
  var ancestry []syntax.Node
  syntax.Walk(file, func(n syntax.Node) bool {
   if n == nil { if len(ancestry)>0 { ancestry=ancestry[:len(ancestry)-1] }; return true }
   ancestry=append(ancestry,n)
   if int(n.Pos().Offset()) <= target.Start && int(n.End().Offset()) >= target.End {
    switch n.(type) {
    case *syntax.Subshell, *syntax.FuncDecl:
     scopes=append(scopes,n)
    }
   }
   return true
  })
  candidates := map[string]scopedVariable{}
  syntax.Walk(file, func(n syntax.Node) bool {
   stmt,ok:=n.(*syntax.Stmt)
   if !ok || int(stmt.Pos().Offset()) >= target.Start { return true }
   call,ok:=stmt.Cmd.(*syntax.CallExpr)
   if !ok || len(call.Args)>0 || len(call.Assigns)==0 { return true }
   // Only unconditional literal assignments are accepted. Other statements
   // can alter state dynamically and are handled by the simulation engine.
   for _, assign:=range call.Assigns {
    if assign.Name==nil || assign.Value==nil { continue }
    var value string
    literal:=true
    for _, part:=range assign.Value.Parts {
     switch p:=part.(type) {
     case *syntax.Lit: value+=p.Value
     case *syntax.SglQuoted: value+=p.Value
     case *syntax.DblQuoted:
      for _, inner:=range p.Parts { lit,ok:=inner.(*syntax.Lit); if !ok {literal=false;break}; value+=lit.Value }
     default: literal=false
     }
    }
    if !literal { continue }
    // Find the nearest function/subshell enclosing the assignment.
    var owner syntax.Node
    syntax.Walk(file,func(n syntax.Node) bool {
     if n==nil {return true}
     switch n.(type) {
     case *syntax.Subshell,*syntax.FuncDecl:
      if n.Pos().Offset()<=assign.Pos().Offset() && n.End().Offset()>=assign.End().Offset() {
       if owner==nil || n.End().Offset()-n.Pos().Offset()<owner.End().Offset()-owner.Pos().Offset() {owner=n}
      }
     }
     return true
    })
    allowed:=owner==nil
    for _,scope:=range scopes {if owner==scope {allowed=true}}
    if !allowed {continue}
    scope:="script"
    if owner!=nil {switch owner.(type) {case *syntax.Subshell:scope="subshell";case *syntax.FuncDecl:scope="function"}}
    copyValue:=value
    candidates[assign.Name.Value]=scopedVariable{Name:assign.Name.Value,Value:&copyValue,Offset:int(assign.Name.Pos().Offset()),End:int(assign.Name.End().Offset()),Line:int(assign.Name.Pos().Line()),Scope:scope}
   }
   return true
  })
  names:=map[string]bool{}
  syntax.Walk(file,func(n syntax.Node) bool {
   if n==nil || int(n.Pos().Offset())<target.Start || int(n.End().Offset())>target.End {return true}
   if expansion,ok:=n.(*syntax.ParamExp);ok && expansion.Param!=nil {names[expansion.Param.Value]=true}
   return true
  })
  vars:=[]scopedVariable{}
  for name:=range names {
   if candidate,ok:=candidates[name];ok {vars=append(vars,candidate)} else {vars=append(vars,scopedVariable{Name:name,Offset:-1,End:-1,Scope:"unknown"})}
  }
  // Sort for stable JSON and predictable React keys.
  for i:=0;i<len(vars);i++ {for j:=i+1;j<len(vars);j++ {if strings.Compare(vars[i].Name,vars[j].Name)>0 {vars[i],vars[j]=vars[j],vars[i]}}}
  result[target.ID]=vars
 }
 return result
}
