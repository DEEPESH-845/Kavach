'use client';

/* MCP Console: the tool surface an agent connects to, driven by hand. */

import { PageHead } from '@/components/console/ui';
import { McpConsole } from '@/components/mcp/McpConsole';

export default function McpPage() {
  return (
    <>
      <PageHead
        title="MCP Console"
        sub="These are the exact tools an AI agent gets when it connects to Kavach — the same ones, called here from your browser. Ask for a refund. Then ask again in different words, from a fresh session, the way a confused agent would. Watch the second one get refused, with the evidence it used to decide."
      />
      <McpConsole />
    </>
  );
}
