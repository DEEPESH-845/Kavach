#!/usr/bin/env python3
"""Entrypoint: Kavach MCP server over stdio.

    python cmd/mcp_server.py          # or: kavach-mcp-server (console script)

Point an MCP client at this instead of razorpay-mcp-server. Same tool names, same
arguments; the tools return financial facts and can refuse. See documents/05-architecture.md.
"""

from kavach.mcp.server import main

if __name__ == "__main__":
    main()
