// The chart tools an AI agent can call, shared by every way an agent reaches the terminal: the
// local MCP server today, the in-app agent panel later. Declaration order is the order agents
// are shown the tools.

export const agentToolTiers = [
  { key: 'read', label: 'Reads the chart', isReadOnly: true },
  { key: 'chart', label: 'Changes the chart', isReadOnly: false },
] as const;

export type AgentToolTier = (typeof agentToolTiers)[number]['key'];

export interface AgentToolSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required?: readonly string[];
  readonly additionalProperties: false;
}

export interface AgentToolInfo {
  readonly name: string;
  readonly title: string;
  readonly tier: AgentToolTier;
  readonly description: string;
  readonly inputSchema: AgentToolSchema;
}

const chartId = { type: 'string', description: 'A chart id from chart_state. Leave out for the active chart.' };
const time = {
  description: 'Chart time as "YYYY-MM-DD HH:MM" (the clock the chart shows, broker server time for MT5 symbols) or epoch milliseconds. Snapped to the nearest bar open.',
  anyOf: [{ type: 'string' }, { type: 'number' }],
};

export const agentTools = [
  {
    name: 'chart_state',
    title: 'Chart state',
    tier: 'read',
    description: 'The charts in the current layout, and for the active (or given) chart: symbol, timeframe, the visible time range, the last bar, its indicators with their inputs, and its drawings. Start here.',
    inputSchema: { type: 'object', properties: { chartId }, additionalProperties: false },
  },
  {
    name: 'get_bars',
    title: 'Get bars',
    tier: 'read',
    description: 'The most recent bars loaded in a chart as compact rows [time, open, high, low, close, volume], oldest first, with a summary (range, 14-bar ATR, last close). To read another timeframe, call set_timeframe first.',
    inputSchema: {
      type: 'object',
      properties: { chartId, count: { type: 'integer', minimum: 1, maximum: 2000, description: 'How many of the latest bars to return. Default 200.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'list_indicators',
    title: 'List indicators',
    tier: 'read',
    description: 'Indicators that can be added to a chart (built-in, MetaTrader and imported Pine scripts) whose title or type contains the query, each with its type and inputs.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Part of a title or type, such as "rsi" or "moving average". Leave out to list all, without inputs.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'list_drawing_tools',
    title: 'List drawing tools',
    tier: 'read',
    description: 'Drawing tool types for the draw tool, with how many points each takes and what the points mean.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'set_timeframe',
    title: 'Set timeframe',
    tier: 'chart',
    description: 'Switch a chart to another timeframe and wait for its bars. Accepts MetaTrader ("M15", "H4", "D1") or TradingView ("15", "4h", "1D") names. Charts in the same interval sync group follow.',
    inputSchema: {
      type: 'object',
      properties: { chartId, timeframe: { type: 'string' } },
      required: ['timeframe'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_indicator',
    title: 'Add indicator',
    tier: 'chart',
    description: 'Add an indicator to a chart. Inputs not given keep their defaults. The user can undo it or remove it from the legend.',
    inputSchema: {
      type: 'object',
      properties: {
        chartId,
        type: { type: 'string', description: 'An indicator type from list_indicators.' },
        inputs: { type: 'object', description: 'Input values by input key, from list_indicators.', additionalProperties: { anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'boolean' }] } },
      },
      required: ['type'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_indicator',
    title: 'Remove indicator',
    tier: 'chart',
    description: 'Remove an indicator from a chart by the id chart_state gives it.',
    inputSchema: { type: 'object', properties: { chartId, id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'draw',
    title: 'Draw',
    tier: 'chart',
    description: 'Draw one or more objects on a chart in a single undoable step. Each gets the tool type, its points in order, and optional text and colour. Drawings made here are marked as the agent\'s, so remove_agent_drawings can clear them without touching the user\'s.',
    inputSchema: {
      type: 'object',
      properties: {
        chartId,
        drawings: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', description: 'A tool type from list_drawing_tools, such as "horizontal-line", "trend-line", "rectangle" or "fib-retracement".' },
              points: { type: 'array', minItems: 1, items: { type: 'object', properties: { time, price: { type: 'number' } }, required: ['time', 'price'], additionalProperties: false } },
              text: { type: 'string', description: 'A label, for tools that show text.' },
              color: { type: 'string', description: 'Line colour as #rrggbb.' },
            },
            required: ['type', 'points'],
            additionalProperties: false,
          },
        },
      },
      required: ['drawings'],
      additionalProperties: false,
    },
  },
  {
    name: 'remove_agent_drawings',
    title: 'Remove agent drawings',
    tier: 'chart',
    description: 'Remove drawings the agent made on a chart: the given ids, or all of them. Never removes the user\'s own drawings.',
    inputSchema: {
      type: 'object',
      properties: { chartId, ids: { type: 'array', items: { type: 'string' } } },
      additionalProperties: false,
    },
  },
] as const satisfies readonly AgentToolInfo[];

export type AgentToolName = (typeof agentTools)[number]['name'];

export interface AgentToolCall {
  readonly name: AgentToolName;
  readonly args: Readonly<Record<string, unknown>>;
}

export type AgentToolReply = { readonly result: unknown } | { readonly error: string };

export interface AgentApi {
  // Answers the main process's tool calls; one handler per page load.
  serve(handler: (call: AgentToolCall) => Promise<unknown>): void;
}

export function isAgentToolName(value: unknown): value is AgentToolName {
  return agentTools.some((tool) => tool.name === value);
}

export function agentToolTier(name: AgentToolName): (typeof agentToolTiers)[number] {
  const tier = agentTools.find((tool) => tool.name === name)!.tier;
  return agentToolTiers.find((candidate) => candidate.key === tier)!;
}
