# mcp-create-tool ![NPM Version](https://img.shields.io/npm/v/%40agentico%2Fmcp-create-tool)
[![FOSSA Status](https://app.fossa.com/api/projects/git%2Bgithub.com%2Fagentico%2Fmcp-create-tool.svg?type=shield)](https://app.fossa.com/projects/git%2Bgithub.com%2agentico%2Fmcp-create-tool?ref=badge_shield)

A command line tool for quickly scaffolding new MCP (Model Context Protocol) tools to be used with the Agentico's MCPServer, an open-source server `facade` implementation for the Model Context Protocol.

**Supports WSL**, Windows, and macOS for the [Claude Desktop App](https://claude.ai/download). If you are using Linux in WSL to develop your code, `mcp-create-tool` supports the creation of the MCP server in the Windows file system, cross-referencing the Linux file system.

**This repository is derived from the original** [create-typescript-server](https://github.com/modelcontextprotocol/create-typescript-server) project.

## Getting Started

```bash
# Create a new tool in the directory `echo-tool`
npx @agentico/mcp-create-tool echo-tool

# With options
npx @agentico/mcp-create-tool echo-tool --name "MCP Echo Tool" --description "A custom MCP tool that echoes input messages."
```

After creating your server:

```bash
cd echo-tool     # Navigate to server directory
npm install      # Install dependencies

npm run build    # Build once
# or...
npm run watch    # Start TypeScript compiler in watch mode

# optional
npm link         # Make your server binary globally available

# Test your server in your browser
npm run inspector
```

## License

This project is licensed under the MIT License—see the [LICENSE](LICENSE) file for details.
