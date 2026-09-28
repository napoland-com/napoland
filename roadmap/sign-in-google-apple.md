---
id: sign-in-google-apple
title: Sign in with Google or Apple
status: done
order: 250
area: tech
depends: [sign-in, play-first]
---

Next to the email code, players can sign in with their Google or Apple account, through the same Supabase sign-in: **Continue with Google** and **Sign in with Apple** sit above the email on the sign-in card. A guest ([play-first](play-first.md)) who signs in this way keeps their character, as with the email code. A sign-in that does not finish comes back to the card with one plain line, and the guest plays on.

The buttons turn on once the owner has set each provider up (Google Cloud, Apple Developer and the Supabase dashboard) and listed it in `AUTH_PROVIDERS` ([OPERATIONS.md](../docs/OPERATIONS.md)); until then the card offers the email code alone.

Why: on a phone, one tap is easier than typing a code from an email, and the design chose Google and Apple for sign-in.

More: [Together: chat and friends](../docs/DESIGN.md#together-chat-and-friends).
