import { MCP_URL } from '../shared/course-meta';

export type ClientId = 'claude' | 'chatgpt' | 'claude-code' | 'cursor' | 'other';

export interface ClientSetup {
  id: ClientId;
  name: string;
  /** Where it works, as the vendor documents it. */
  plans: string;
  steps: string[];
  snippet?: string;
  docsUrl: string;
}

export const CLAUDE_CODE_COMMAND = `claude mcp add --transport http learn-wp-reimagined ${MCP_URL}`;

export const CURSOR_SNIPPET = JSON.stringify({ mcpServers: { 'learn-wp-reimagined': { url: MCP_URL } } }, null, 2);

// Steps written from each vendor's documented flow, checked 2026-10-20; the sign-in steps are NOT yet checked
// against each vendor: re-check them, and on launch day (plan B readiness checklist): connector menus move often.
//  - Claude: https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp
//  - ChatGPT: https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta
//    (sources disagree on which plans allow write tools; learning-mcp open question 7)
//  - Claude Code: https://code.claude.com/docs/en/mcp
//  - Cursor: https://cursor.com/docs/context/mcp
// The server asks the agent to sign in, so no step chooses "no authentication".
export const CLIENT_SETUPS: ClientSetup[] = [
  {
    id: 'claude',
    name: 'Claude',
    plans: 'Custom connectors work on Free (one connector), Pro, Max, Team and Enterprise.',
    steps: [
      'Open Customize, then Connectors.',
      'Choose Add, then Add custom connector.',
      'Name it "Learn WordPress, reimagined" and paste the connector URL.',
      'Leave the advanced settings as they are, then Add.',
      'In a new chat, turn the connector on and ask Claude to teach you the course. Sign in when Claude asks.',
    ],
    docsUrl: 'https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    plans: "Needs developer mode, which depends on your plan. Check OpenAI's page for yours.",
    steps: [
      'Open Settings, then Apps & Connectors, then Advanced settings, and turn on Developer mode.',
      'Create a connector: give it a name and paste the connector URL.',
      'Choose OAuth for authentication, confirm you trust it, and save.',
      'In a new chat, pick the connector from the developer mode menu and ask ChatGPT to teach you the course. Sign in when it asks.',
    ],
    docsUrl: 'https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    plans: 'Runs in your terminal, on any plan that includes Claude Code.',
    steps: ['Run this command once.', 'Start Claude Code, run /mcp, choose the server and sign in when it asks. Then ask it to teach you the course.'],
    snippet: CLAUDE_CODE_COMMAND,
    docsUrl: 'https://code.claude.com/docs/en/mcp',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    plans: 'Works in any Cursor plan with MCP.',
    steps: [
      'Add this to .cursor/mcp.json in your project, or to ~/.cursor/mcp.json for every project.',
      'Open the chat, sign in when Cursor asks, and ask it to teach you the course.',
    ],
    snippet: CURSOR_SNIPPET,
    docsUrl: 'https://cursor.com/docs/context/mcp',
  },
  {
    id: 'other',
    name: 'Any MCP client',
    plans: 'Any client that speaks MCP over Streamable HTTP.',
    steps: ['Add the connector URL as a remote (Streamable HTTP) server. Sign in when your agent asks.'],
    docsUrl: 'https://modelcontextprotocol.io/docs/learn/client-concepts',
  },
];
