# Medirus - CLI Demo
# Run with: vhs cli.tape

Output cli.gif
Output cli.webm

Set Shell "bash"
Set FontSize 16
Set Width 900
Set Height 500
Set Theme "Catppuccin Mocha"
Set Padding 20
Set Framerate 30

# Title
Type "# 🚀 Medirus CLI"
Enter
Sleep 500ms
Enter

# Show help
Type "npx medirus --help"
Enter
Sleep 1s

# Simulated help output
Type@100ms "
🚀 Medirus - X/Twitter Automation Toolkit

Usage: medirus <command> [options]

Commands:
  unfollow     Unfollow accounts (non-followers, everyone)
  scrape       Scrape followers, following, tweets
  monitor      Monitor account for changes
  mcp          Start MCP server for AI agents
  detect       Detect unfollowers

Options:
  --help       Show help
  --version    Show version

Examples:
  medirus unfollow --non-followers
  medirus scrape --followers @username
  medirus mcp --stdio
"
Sleep 2s
Enter

# Run a command
Type "npx medirus mcp --stdio"
Enter
Sleep 1s

Type@50ms "🤖 MCP Server started on stdio"
Enter
Type@50ms "📡 Waiting for AI agent connections..."
Enter
Sleep 2s
