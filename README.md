# Claude Code mods by krysmalskipl

Mods for [Claude Code](https://claude.com/claude-code), built on function hooks. Install only the ones you want.

## Install

Add the marketplace once, then install any mod by name:

```sh
claude plugin marketplace add krysmalskipl/claude-code-mods
claude plugin install openrouter-balance@krysmalskipl
```

Restart Claude Code after installing. To try a mod without installing:

```sh
git clone https://github.com/krysmalskipl/claude-code-mods && cd claude-code-mods
claude --plugin-dir mods/openrouter-balance
```

Needs Claude Code 2.1.287+.

## Mods

| | Mod | What it does | Command |
| --- | --- | --- | --- |
| 🪙 | **openrouter-balance** | Your OpenRouter credit: the real balance with a gauge, today's spend and the model the money mostly went to. A regular API key shows its own spend and limit instead | `/openrouter-balance` |

### 🪙 openrouter-balance

![openrouter-balance: OpenRouter key limit and today's spend above the Claude Code prompt](images/openrouter-balance.png)

- One line above the prompt: the balance with a gauge, today's spend, and the model the last 30 days' money mostly went to
- **A management key** (openrouter.ai → Settings → Management keys) sees the account: the real balance from `/credits` and spend by model from `/activity`. It can't make model calls, so it's safe to keep around
- **A regular API key** sees only itself: its spend today and this month, and what its limit leaves when it has one
- Green from $5, yellow under $5, red under $2
- `/openrouter-balance` shows the breakdown: balance, today, yesterday, last 30 days, and spend, requests and tokens by model. With a regular key: today, this week, this month, all time, its limit and budget
- "Today" is the UTC day. With a management key it's the usage now minus where it stood when the mod first saw the day; a day first seen after 00:15 UTC shows "since HH:MM"
- **Key:** from `/config` → openrouter-balance, else `OPENROUTER_MANAGEMENT_KEY`, else `OPENROUTER_API_KEY`, else the macOS Keychain item `openrouter-key`. Kept in memory only, sent only to openrouter.ai
- Refreshes every 5 minutes and after each turn; a minute after a failure. A failed refresh keeps the last numbers, marked offline

## Develop

```sh
claude plugin validate mods/<name>
CLAUDE_CONFIG_DIR=$(mktemp -d) claude plugin test mods/<name>
```

More mods: [hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods).

## License

MIT
