#!/bin/sh
# PreToolUse guard: refuse shell commands that would touch production.
# AGENTS.md says never; this makes it a machine rule, not a hope.
cmd=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input?.command||"")}catch{}})')

if printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_])aws[[:space:]]|tools/deploy\.mjs|cloudformation|(^|[[:space:]/])(infra|deploy)/'; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Production and AWS are off limits in agent sessions (AGENTS.md, Hard limits). Releases are pushes to main, run by the owner."}}'
fi
exit 0
