#!/usr/bin/env node

import dotenv from 'dotenv';
dotenv.config();

import express from 'express'; // Import Express
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
// Import the SSE transport instead of Stdio
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
// Assuming your local file imports are correct and use .js extension
import { SendGridService } from "./services/sendgrid.js";
import { getToolDefinitions, handleToolCall } from "./tools/index.js";

// Initialize SendGrid with API key from environment variable
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
if (!SENDGRID_API_KEY) {
  // Log error and exit cleanly in production environments if key is missing
  console.error('FATAL: SENDGRID_API_KEY environment variable is required');
  process.exit(1); // Exit if key is missing
}

// Initialize the SendGrid service
const sendGridService = new SendGridService(SENDGRID_API_KEY);

// Initialize the MCP Server (low-level)
const server = new Server(
  {
    name: "sendgrid-mcp-server",
    version: "0.2.0", // Consider updating version if you modify functionality
  },
  {
    capabilities: {
      tools: {}, // Capabilities might be automatically populated or need definition
    },
  }
);

/**
 * Handler that lists available tools.
 * Exposes all SendGrid API capabilities as tools.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  console.log("Handling ListToolsRequest..."); // Add logging
  try {
      const tools = getToolDefinitions(sendGridService);
      console.log(`Found ${tools.length} tools.`);
      return { tools };
  } catch (error) {
      console.error("Error getting tool definitions:", error);
      throw new McpError(ErrorCode.InternalError, 'Failed to get tool definitions');
  }
});

/**
 * Handler for tool calls.
 * Routes each tool call to the appropriate SendGrid service method.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  console.log(`Handling CallToolRequest for tool: ${request.params.name}`); // Add logging
  try {
    // Ensure arguments are passed correctly, might need JSON parsing if applicable
    const args = typeof request.params.arguments === 'string'
      ? JSON.parse(request.params.arguments)
      // biome-ignore lint/suspicious/noExplicitAny: <explanation>
      : request.params.arguments as any; // Use type assertion carefully

    const result = await handleToolCall(sendGridService, request.params.name, args);
    console.log(`Tool call ${request.params.name} successful.`);
    return result;
  } catch (error: unknown) { // Use unknown for better type safety
    console.error(`SendGrid Error during tool call ${request.params.name}:`, error);

    // Handle SendGrid API errors (check if error has response structure)
    // biome-ignore lint/suspicious/noExplicitAny: <explanation>
    const anyError = error as any;
    if (anyError.response?.body?.errors) {
      throw new McpError(
        ErrorCode.InternalError,
        `SendGrid API Error: ${anyError.response.body.errors.map((e: { message: string }) => e.message).join(', ')}`
      );
    }

    // Handle other errors
    if (error instanceof Error) {
      throw new McpError(
        ErrorCode.InternalError,
        error.message
      );
    }

    // Fallback for unknown errors
    throw new McpError(ErrorCode.InternalError, 'An unexpected error occurred during tool call');
  }
});

// --- Express App Setup ---
const app = express();
app.use(express.json()); // Middleware to parse JSON bodies

// --- MCP HTTP Transport Setup ---
// Create the SSE transport, linking it to the server instance
// Note: The exact API for SSEServerTransport might vary slightly by SDK version.
// This assumes it takes the server instance and potentially options.
const transport = new SSEServerTransport({ server });

// Register the MCP routes with the Express app
// These endpoints are typically used by standard MCP clients
// GET /mcp/sse (or similar) for the event stream
// POST /mcp/message (or similar) for the client to send messages
// Consult the @modelcontextprotocol/sdk documentation for the exact handlers/paths
// provided by SSEServerTransport. These are common patterns:
app.get('/mcp/sse', transport.handleEventStream()); // Example path/handler
app.post('/mcp/message', transport.handleMessage()); // Example path/handler

// Add a simple root endpoint for health checks or basic info
app.get('/', (req, res) => {
  res.status(200).send(`${server.name} v${server.version} is running.`);
});


// --- Start the HTTP Server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  // Use a different log message to distinguish from the stdio version
  console.log(`✅ SendGrid MCP HTTP server running on port ${PORT}`);
  console.log(`MCP SSE endpoint likely at /mcp/sse`);
  console.log(`MCP Message endpoint likely at /mcp/message`);
});

// We don't need the main function wrapping server.connect for stdio anymore
// async function main() { ... }
// main();
