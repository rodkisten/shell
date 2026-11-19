//go:build js && wasm

package main

import "strings"

func stringsReader(source string) *strings.Reader { return strings.NewReader(source) }
