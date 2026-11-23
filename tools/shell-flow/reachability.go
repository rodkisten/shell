//go:build js && wasm

package main

// flowNodeStates distinguishes nodes reachable on a known path from nodes
// reached only through an unresolved condition. It never executes commands.
func flowNodeStates(nodes []node, edges []edge, decisions map[string]string) map[string]string {
 states := make(map[string]string, len(nodes))
 if len(nodes) == 0 { return states }
 incoming := make(map[string]int, len(nodes))
 outgoing := make(map[string][]edge, len(nodes))
 for _, n := range nodes {
  incoming[n.ID] = 0
  states[n.ID] = "unreachable"
 }
 for _, e := range edges {
  if _, ok := incoming[e.From]; !ok { continue }
  if _, ok := incoming[e.To]; !ok { continue }
  incoming[e.To]++
  outgoing[e.From] = append(outgoing[e.From], e)
 }
 type visit struct { id string; uncertain bool }
 queue := make([]visit, 0, len(nodes))
 for _, n := range nodes {
  if incoming[n.ID] == 0 { queue = append(queue, visit{n.ID, false}) }
 }
 if len(queue) == 0 { queue = append(queue, visit{nodes[0].ID, false}) }
 // Visit each node at most twice: once via a certain path, once via an
 // uncertain path. A certain path always wins when paths converge.
 seen := make(map[string]uint8)
 for len(queue) > 0 {
  current := queue[0]
  queue = queue[1:]
  bit := uint8(1)
  if current.uncertain { bit = 2 }
  if seen[current.id]&bit != 0 { continue }
  seen[current.id] |= bit
  if !current.uncertain {
   states[current.id] = "reachable"
  } else if states[current.id] != "reachable" {
   states[current.id] = "indeterminate"
  }
  for _, e := range outgoing[current.id] {
   uncertain := current.uncertain
   if e.Kind == "true" || e.Kind == "false" {
    decision := decisions[current.id]
    if decision == "true" || decision == "false" {
     if e.Kind != decision { continue }
    } else {
     uncertain = true
    }
   }
   queue = append(queue, visit{e.To, uncertain})
  }
 }
 return states
}

// reachableFlowNodes retains the original boolean contract for callers that
// only need to know whether a path is possible.
func reachableFlowNodes(nodes []node, edges []edge, decisions map[string]string) map[string]bool {
 states := flowNodeStates(nodes, edges, decisions)
 reachable := make(map[string]bool, len(states))
 for id, state := range states { reachable[id] = state != "unreachable" }
 return reachable
}
