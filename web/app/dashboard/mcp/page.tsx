'use client';

/* MCP Console: the tool surface an agent connects to, driven by hand. */

import { PageHead } from '@/components/console/ui';
import { McpConsole } from '@/components/mcp/McpConsole';

export default function McpPage() {
  return (
    <>
      <PageHead
        title="MCP Console"
        sub="The exact tool functions kavach-mcp-server exposes over stdio, called over HTTP. Ask for a refund, then ask again with different words from a new session — and watch the same tool refuse the second one with the evidence it relied on."
      />
      <McpConsole />
    </>
  );
}
