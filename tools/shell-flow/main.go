//go:build js && wasm

package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"syscall/js"

	"mvdan.cc/sh/v3/syntax"
)

type node struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	Start int    `json:"start"`
	End   int    `json:"end"`
}

type edge struct {
	From string `json:"from"`
	To   string `json:"to"`
	Kind string `json:"kind"`
}

type result struct {
	Nodes      []node                      `json:"nodes"`
	Edges      []edge                      `json:"edges"`
	Warnings   []string                    `json:"warnings"`
	Decisions  map[string]string           `json:"decisions,omitempty"`
	Reachable  map[string]bool             `json:"reachable,omitempty"`
	NodeStates map[string]string           `json:"nodeStates,omitempty"`
	Variables  map[string][]scopedVariable `json:"variables,omitempty"`
}

func analyze(source string, variables map[string]json.RawMessage) (result, error) {
	file, err := syntax.NewParser(
		syntax.Variant(syntax.LangBash),
		syntax.KeepComments(true),
	).Parse(strings.NewReader(source), "script.sh")
	if err != nil {
		return result{}, err
	}

	out := result{
		Nodes: []node{},
		Edges: []edge{},
		Warnings: []string{
			"Static control-flow approximation; not an observed runtime trace.",
			"Bash parser mode; Zsh-specific syntax (e.g., glob qualifiers or zsh-only flags) may be unsupported.",
		},
	}

	var sequence int
	add := func(kind string, pos, end syntax.Pos) string {
		id := fmt.Sprintf("node-%d", sequence)
		sequence++
		out.Nodes = append(out.Nodes, node{
			ID:    id,
			Kind:  kind,
			Start: int(pos.Offset()),
			End:   int(end.Offset()),
		})
		return id
	}

	connect := func(from, to, kind string) {
		if from != "" && to != "" {
			out.Edges = append(out.Edges, edge{From: from, To: to, Kind: kind})
		}
	}

	type exit struct{ id, kind string }

	invertExits := func(exits []exit) []exit {
		outExits := make([]exit, len(exits))
		for i, e := range exits {
			switch e.kind {
			case "true":
				outExits[i] = exit{e.id, "false"}
			case "false":
				outExits[i] = exit{e.id, "true"}
			default:
				outExits[i] = e
			}
		}
		return outExits
	}

	isTerminalCommand := func(cmd syntax.Command) bool {
		call, ok := cmd.(*syntax.CallExpr)
		if !ok || len(call.Args) == 0 || len(call.Args[0].Parts) == 0 {
			return false
		}
		if lit, ok := call.Args[0].Parts[0].(*syntax.Lit); ok {
			return lit.Value == "exit" || lit.Value == "return"
		}
		return false
	}

	var walkStmt func(*syntax.Stmt) (string, []exit)
	var walkIf func(*syntax.IfClause) (string, []exit)
	var walkWhile func(*syntax.WhileClause) (string, []exit)
	var walkFor func(*syntax.ForClause) (string, []exit)
	var walkCase func(*syntax.CaseClause) (string, []exit)
	var walkList func([]*syntax.Stmt) (string, []exit)

	walkList = func(stmts []*syntax.Stmt) (string, []exit) {
		var first string
		var previous []exit
		for _, stmt := range stmts {
			entry, exits := walkStmt(stmt)
			if first == "" {
				first = entry
			}
			for _, e := range previous {
				connect(e.id, entry, e.kind)
			}
			previous = exits
		}
		return first, previous
	}

	walkStmt = func(stmt *syntax.Stmt) (string, []exit) {
		if stmt == nil || stmt.Cmd == nil {
			return "", nil
		}

		var entry string
		var exits []exit

		switch cmd := stmt.Cmd.(type) {
		case *syntax.BinaryCmd:
			left, leftExits := walkStmt(cmd.X)
			right, rightExits := walkStmt(cmd.Y)
			switch cmd.Op.String() {
			case "&&", "||":
				condition, bypass := "true", "false"
				if cmd.Op.String() == "||" {
					condition, bypass = bypass, condition
				}
				for _, e := range leftExits {
					connect(e.id, right, condition)
				}
				exits = append([]exit{}, rightExits...)
				for _, e := range leftExits {
					exits = append(exits, exit{e.id, bypass})
				}
				entry = left
			case "|", "|&":
				for _, e := range leftExits {
					connect(e.id, right, "pipeline")
				}
				entry, exits = left, rightExits
			default:
				id := add("Stmt", stmt.Pos(), stmt.End())
				entry, exits = id, []exit{{id, "next"}}
			}

		case *syntax.IfClause:
			entry, exits = walkIf(cmd)

		case *syntax.WhileClause:
			entry, exits = walkWhile(cmd)

		case *syntax.ForClause:
			entry, exits = walkFor(cmd)

		case *syntax.CaseClause:
			entry, exits = walkCase(cmd)

		case *syntax.Block:
			entry, exits = walkList(cmd.Stmts)
			if entry == "" {
				id := add("Block", stmt.Pos(), stmt.End())
				entry, exits = id, []exit{{id, "next"}}
			}

		case *syntax.Subshell:
			entry, exits = walkList(cmd.Stmts)
			if entry == "" {
				id := add("Subshell", stmt.Pos(), stmt.End())
				entry, exits = id, []exit{{id, "next"}}
			}

		case *syntax.FuncDecl:
			// Declaração de função cria um nó de definição; o corpo só executa quando chamado.
			id := add("FuncDecl", stmt.Pos(), stmt.End())
			entry, exits = id, []exit{{id, "next"}}

		case *syntax.CoprocClause:
			id := add("Coproc", stmt.Pos(), stmt.End())
			entry, exits = id, []exit{{id, "next"}}

		default:
			id := add("Stmt", stmt.Pos(), stmt.End())
			entry = id
			if isTerminalCommand(cmd) {
				exits = []exit{}
			} else {
				exits = []exit{{id, "next"}}
			}
		}

		if stmt.Negated {
			exits = invertExits(exits)
		}

		return entry, exits
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
			for _, e := range condExits {
				connect(e.id, thenEntry, "true")
			}
		} else {
			for _, e := range condExits {
				exits = append(exits, exit{e.id, "true"})
			}
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
				for _, e := range condExits {
					connect(e.id, elseEntry, "false")
				}
				exits = append(exits, elseExits...)
			} else {
				for _, e := range condExits {
					exits = append(exits, exit{e.id, "false"})
				}
			}
		} else {
			for _, e := range condExits {
				exits = append(exits, exit{e.id, "false"})
			}
		}
		return condEntry, exits
	}

	walkWhile = func(clause *syntax.WhileClause) (string, []exit) {
		condEntry, condExits := walkList(clause.Cond)
		if condEntry == "" {
			id := add("WhileClause", clause.Pos(), clause.End())
			return id, []exit{{id, "unknown"}}
		}

		continueLabel, breakLabel := "true", "false"
		if clause.Until {
			continueLabel, breakLabel = "false", "true"
		}

		doEntry, doExits := walkList(clause.Do)
		if doEntry != "" {
			for _, e := range condExits {
				connect(e.id, doEntry, continueLabel)
			}
			for _, e := range doExits {
				connect(e.id, condEntry, "loop")
			}
		}

		var exits []exit
		for _, e := range condExits {
			exits = append(exits, exit{e.id, breakLabel})
		}
		return condEntry, exits
	}

	walkFor = func(clause *syntax.ForClause) (string, []exit) {
		endPos := clause.DoPos
		if !endPos.IsValid() {
			endPos = clause.End()
		}
		kind := "ForClause"
		if clause.Select {
			kind = "SelectClause"
		}
		headerID := add(kind, clause.Pos(), endPos)

		doEntry, doExits := walkList(clause.Do)
		if doEntry != "" {
			connect(headerID, doEntry, "loop")
			for _, e := range doExits {
				connect(e.id, headerID, "loop")
			}
		}

		return headerID, []exit{{headerID, "next"}}
	}

	walkCase = func(clause *syntax.CaseClause) (string, []exit) {
		endPos := clause.In
		if !endPos.IsValid() {
			endPos = clause.End()
		}
		headerID := add("CaseClause", clause.Pos(), endPos)

		if len(clause.Items) == 0 {
			return headerID, []exit{{headerID, "next"}}
		}

		var exits []exit
		hasDefault := false
		itemEntries := make([]string, len(clause.Items))
		itemExitsList := make([][]exit, len(clause.Items))

		for i, item := range clause.Items {
			label := fmt.Sprintf("case:%d", i)
			itemEntry, itemExits := walkList(item.Stmts)
			itemEntries[i] = itemEntry
			itemExitsList[i] = itemExits

			if itemEntry != "" {
				connect(headerID, itemEntry, label)
			} else {
				exits = append(exits, exit{headerID, label})
			}

			for _, pat := range item.Patterns {
				if len(pat.Parts) == 1 {
					if lit, ok := pat.Parts[0].(*syntax.Lit); ok && lit.Value == "*" {
						hasDefault = true
					}
				}
			}
		}

		// Tratar operadores de término de item: ;; (break), ;& (fallthrough), ;;& (continue testing)
		for i, item := range clause.Items {
			op := item.Op.String()
			switch op {
			case ";&", ";;&":
				if i+1 < len(clause.Items) && itemEntries[i+1] != "" {
					if len(itemExitsList[i]) > 0 {
						for _, e := range itemExitsList[i] {
							connect(e.id, itemEntries[i+1], "fallthrough")
						}
					} else {
						connect(headerID, itemEntries[i+1], "fallthrough")
					}
				} else {
					exits = append(exits, itemExitsList[i]...)
				}
			default: // ";;" ou vazio
				exits = append(exits, itemExitsList[i]...)
			}
		}

		if !hasDefault {
			exits = append(exits, exit{headerID, "case:none"})
		}

		return headerID, exits
	}

	_, _ = walkList(file.Stmts)
	out.Variables = scopeVariables(file, out.Nodes)
	out.Decisions = simulateConditions(source, file, out.Nodes, variables)
	out.NodeStates = flowNodeStates(out.Nodes, out.Edges, out.Decisions)
	out.Reachable = reachableFlowNodes(out.Nodes, out.Edges, out.Decisions)
	return out, nil
}

func main() {
	callback := js.FuncOf(func(this js.Value, args []js.Value) any {
		if len(args) == 0 {
			return errorJSON(fmt.Errorf("missing source"))
		}
		variables := map[string]json.RawMessage{}
		if len(args) > 1 && args[1].Type() == js.TypeString {
			if err := json.Unmarshal([]byte(args[1].String()), &variables); err != nil {
				return errorJSON(err)
			}
		}
		out, err := analyze(args[0].String(), variables)
		if err != nil {
			return errorJSON(err)
		}
		data, err := json.Marshal(out)
		if err != nil {
			return errorJSON(err)
		}
		return string(data)
	})
	js.Global().Set("shellFlowAnalyze", callback)
	select {}
}

func errorJSON(err error) string {
	data, _ := json.Marshal(map[string]string{"error": err.Error()})
	return string(data)
}
