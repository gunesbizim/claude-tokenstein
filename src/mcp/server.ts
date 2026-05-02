export async function startMcpServer(): Promise<void> {
  // MCP server stub — full implementation in Step 10
  const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const server = new Server(
    { name: "claude-tokenstein", version: "0.1.0" },
    { capabilities: {} },
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
