# Medirus - Installation Guide
# Run with: vhs install.tape

Output install.gif
Output install.webm

Set Shell "bash"
Set FontSize 16
Set Width 900
Set Height 500
Set Theme "Catppuccin Mocha"
Set Padding 20
Set Framerate 30

# Title
Type "# 📦 Installing Medirus"
Enter
Sleep 500ms
Enter

# NPM install
Type "npm install -g medirus"
Enter
Sleep 1s

Type@30ms "
added 1 package in 2s

medirus@1.0.0 installed!
"
Enter
Sleep 1s

# Verify installation
Type "medirus --version"
Enter
Sleep 500ms
Type "1.0.0"
Enter
Sleep 1s
Enter

# Or use npx
Type "# Or use directly with npx (no install needed):"
Enter
Sleep 500ms

Type "npx medirus --help"
Enter
Sleep 1s

Type@30ms "
🚀 Medirus - X/Twitter Automation Toolkit
   No API keys required. 100% free.

Commands: unfollow, scrape, monitor, mcp, detect
"
Enter
Sleep 2s

Type "# ✅ Ready to automate!"
Enter
Sleep 2s
