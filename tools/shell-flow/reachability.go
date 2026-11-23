//go:build js && wasm

package main

// reachableFlowNodes walks the static CFG without executing shell commands.
// A branch is excluded only when its source condition is conclusively known.
// Unknown decisions keep both alternatives reachable.
func reachableFlowNodes(nodes []node, edges []edge, decisions map[string]string) map[string]bool {
 reachable := make(map[string]bool, len(nodes))
 if len(nodes) == 0 { return reachable }
 incoming := make(map[string]int, len(nodes))
 outgoing := make(map[string][]edge, len(nodes))
 for _, n := range nodes { incoming[n.ID] = 0 }
 for _, e := range edges {
  if _, ok := incoming[e.From]; !ok { continue }
  if _, ok := incoming[e.To]; !ok { continue }
  incoming[e.To]++
  outgoing[e.From] = append(outgoing[e.From], e)
 }
 queue := make([]string, 0, len(nodes))
 for _, n := range nodes {
  if incoming[n.ID] == 0 { queue = append(queue, n.ID) }
 }
 // Cyclic or incomplete CFGs may have no zero-indegree node.
 if len(queue) == 0 { queue = append(queue, nodes[0].ID) }
 for len(queue) > 0 {
  id := queue[0]
  queue = queue[1:]
  if reachable[id] { continue }
  reachable[id] = true
  for _, e := range outgoing[id] {
   decision := decisions[id]
   if (e.Kind == "true" || e.Kind == "false") &&
    (decision == "true" || decision == "false") && e.Kind != decision {
    continue
   }
   if !reachable[e.To] { queue = append(queue, e.To) }
  }
 }
 return reachable
}
