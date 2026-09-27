---
id: sign-in
title: Sign in with an email code
status: done
order: 60
area: tech
---

Players sign in with their email and a 6-digit code that arrives by email, through Supabase Auth. The game server checks the login and keeps its own players and game data in its own database, as it did before. A character made before sign-in can be claimed by signing in on the same browser. Google and Apple come later, through the same sign-in: see [sign-in-google-apple](sign-in-google-apple.md).

Why: before sign-in, a character lived only in the browser that made it. Chat, friends and items are worth keeping, so sign-in comes before any of them opens to the public.

More: [Together: chat and friends](../docs/DESIGN.md#together-chat-and-friends).
