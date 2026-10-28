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

// Steps written from each vendor's documented flow, checked 2026-10-20. The flag-on steps in standardClientSetups are NOT yet checked: re-check before agentOnStandard flips. Re-check on launch day
// (plan B readiness checklist): connector menus move often.
//  - Claude: https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp
//  - ChatGPT: https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta
//    (sources disagree on which plans allow write tools; learning-mcp open question 7)
//  - Claude Code: https://code.claude.com/docs/en/mcp
//  - Cursor: https://cursor.com/docs/context/mcp
export const CLIENT_SETUPS: ClientSetup[] = [
  {
    id: 'claude',
    name: 'Claude',
    plans: 'Custom connectors work on Free (one connector), Pro, Max, Team and Enterprise.',
    steps: [
      'Open Customize, then Connectors.',
      'Choose Add, then Add custom connector.',
      'Name it "Learn WordPress, reimagined" and paste the connector URL.',
      'For authentication, choose No sign in (no authentication), then Add.',
      'In a new chat, turn the connector on and ask Claude to teach you the course.',
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
      'For authentication, choose no authentication, confirm you trust it, and save.',
      'In a new chat, pick the connector from the developer mode menu and ask ChatGPT to teach you the course.',
    ],
    docsUrl: 'https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    plans: 'Runs in your terminal, on any plan that includes Claude Code.',
    steps: ['Run this command once.', 'Start Claude Code and ask it to teach you the course. Run /mcp to check the connection.'],
    snippet: CLAUDE_CODE_COMMAND,
    docsUrl: 'https://code.claude.com/docs/en/mcp',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    plans: 'Works in any Cursor plan with MCP.',
    steps: ['Add this to .cursor/mcp.json in your project, or to ~/.cursor/mcp.json for every project.', 'Open the chat and ask it to teach you the course.'],
    snippet: CURSOR_SNIPPET,
    docsUrl: 'https://cursor.com/docs/context/mcp',
  },
  {
    id: 'other',
    name: 'Any MCP client',
    plans: 'Any client that speaks MCP over Streamable HTTP.',
    steps: ['Add the connector URL as a remote (Streamable HTTP) server, with no authentication.'],
    docsUrl: 'https://modelcontextprotocol.io/docs/learn/client-concepts',
  },
];

/** The same setups for the standard server, which asks the agent to sign in: no "no authentication" step. */
export function standardClientSetups(): ClientSetup[] {
  return CLIENT_SETUPS.map((c) => {
    switch (c.id) {
      case 'claude':
        return { ...c, steps: [...c.steps.slice(0, 3), 'Leave the advanced settings as they are, then Add.', 'In a new chat, turn the connector on and ask Claude to teach you the course. Sign in when Claude asks.'] };
      case 'chatgpt':
        return {
          ...c,
          steps: [
            c.steps[0],
            c.steps[1],
            'Choose OAuth for authentication, confirm you trust it, and save.',
            'In a new chat, pick the connector from the developer mode menu and ask ChatGPT to teach you the course. Sign in when it asks.',
          ],
        };
      case 'claude-code':
        return { ...c, steps: ['Run this command once.', 'Start Claude Code, run /mcp, choose the server and sign in when it asks. Then ask it to teach you the course.'] };
      case 'cursor':
        return { ...c, steps: [c.steps[0], 'Open the chat, sign in when Cursor asks, and ask it to teach you the course.'] };
      default:
        return { ...c, steps: ['Add the connector URL as a remote (Streamable HTTP) server. Sign in when your agent asks.'] };
    }
  });
}
