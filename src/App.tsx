// ─────────────────────────────────────────────────────────────
// SENTRI App — root component
//
// Layout: CSS Grid, 3-column, header + body + command bar
// State: useReducer for incidents, useConnectionStatus for health
// ─────────────────────────────────────────────────────────────

import { useReducer, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";

import { HeaderBar } from "./components/HeaderBar";
import { IncidentFeed } from "./components/IncidentFeed";
import { AnalysisOutput } from "./components/AnalysisOutput";
import { HindsightRecall } from "./components/HindsightRecall";
import { CommandBar } from "./components/CommandBar";

import { useConnectionStatus } from "./hooks/useConnectionStatus";
import { parseAndExecuteCommand } from "./hooks/useCommandParser";

import type { IncidentEntry, SimilarIncident, SENTRIResponse } from "./types/sentri";

// ── App State + Reducer ───────────────────────────────────────

type CenterContent =
  | { kind: "incident"; id: string }
  | { kind: "help" }
  | { kind: "error"; text: string }
  | { kind: "empty" };

interface AppState {
  incidents: IncidentEntry[];
  selectedId: string | null;
  commandHistory: string[];
  centerContent: CenterContent;
  recallResults: SimilarIncident[];
  isNovelRecall: boolean;
}

type AppAction =
  | { type: "ADD_INCIDENT"; incident: IncidentEntry }
  | { type: "UPDATE_INCIDENT"; id: string; response: SENTRIResponse; isNovel: boolean }
  | { type: "SELECT_INCIDENT"; id: string }
  | { type: "ADD_COMMAND"; cmd: string }
  | { type: "SET_CENTER"; content: CenterContent }
  | { type: "SET_RECALL"; results: SimilarIncident[]; isNovel: boolean }
  | { type: "CLEAR_CENTER" }
  | { type: "MARK_LOADING"; id: string };

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "ADD_INCIDENT":
      return {
        ...state,
        incidents: [action.incident, ...state.incidents],
        selectedId: action.incident.id,
        centerContent: { kind: "incident", id: action.incident.id },
      };

    case "UPDATE_INCIDENT": {
      const updated = state.incidents.map((inc) =>
        inc.id === action.id
          ? { ...inc, response: action.response, isLoading: false, isNovel: action.isNovel }
          : inc
      );
      return { ...state, incidents: updated };
    }

    case "SELECT_INCIDENT":
      return {
        ...state,
        selectedId: action.id,
        centerContent: { kind: "incident", id: action.id },
      };

    case "ADD_COMMAND": {
      const trimmed = action.cmd.trim();
      if (!trimmed) return state;
      const history = [trimmed, ...state.commandHistory].slice(0, 50);
      return { ...state, commandHistory: history };
    }

    case "SET_CENTER":
      return {
        ...state,
        centerContent: action.content,
        selectedId:
          action.content.kind === "incident" ? action.content.id : state.selectedId,
      };

    case "SET_RECALL":
      return {
        ...state,
        recallResults: action.results,
        isNovelRecall: action.isNovel,
      };

    case "CLEAR_CENTER":
      return {
        ...state,
        centerContent: { kind: "empty" },
        recallResults: [],
        isNovelRecall: false,
      };

    case "MARK_LOADING": {
      const updated = state.incidents.map((inc) =>
        inc.id === action.id ? { ...inc, isLoading: true } : inc
      );
      return { ...state, incidents: updated };
    }

    default:
      return state;
  }
}

const initialState: AppState = {
  incidents: [],
  selectedId: null,
  commandHistory: [],
  centerContent: { kind: "empty" },
  recallResults: [],
  isNovelRecall: false,
};

// ── App ───────────────────────────────────────────────────────

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const connectionStatus = useConnectionStatus();

  // ── Command handler ─────────────────────────────────────
  const handleCommand = useCallback(
    async (raw: string) => {
      dispatch({ type: "ADD_COMMAND", cmd: raw });

      const result = await parseAndExecuteCommand(raw);

      switch (result.kind) {
        case "clear":
          dispatch({ type: "CLEAR_CENTER" });
          break;

        case "help":
          dispatch({ type: "SET_CENTER", content: { kind: "help" } });
          break;

        case "history": {
          // Show last n entries — just keep feed as-is, select none
          const sliced = state.incidents.slice(0, result.n);
          if (sliced.length > 0 && sliced[0]) {
            dispatch({ type: "SELECT_INCIDENT", id: sliced[0].id });
          }
          break;
        }

        case "recall":
          dispatch({
            type: "SET_RECALL",
            results: result.response.results,
            isNovel: result.response.count === 0,
          });
          dispatch({ type: "SET_CENTER", content: { kind: "empty" } });
          break;

        case "analyze":
        case "session": {
          const id = uuidv4();
          const triggerType = result.triggerType;
          const severity = result.severity;
          const response = result.response;
          const isNovel =
            !response.context?.overridden &&
            (response.similarIncidents?.length === 0 ||
              !response.similarIncidents?.some((i) => i.distance < 0.5));

          const entry: IncidentEntry = {
            id,
            timestamp: new Date(),
            triggerType,
            severity,
            response,
            isNovel,
            isLoading: false,
          };

          dispatch({ type: "ADD_INCIDENT", incident: entry });

          // Auto-populate recall pane
          dispatch({
            type: "SET_RECALL",
            results: response.similarIncidents ?? response.context?.pastIncidents ?? [],
            isNovel,
          });
          break;
        }

        case "error":
          dispatch({
            type: "SET_CENTER",
            content: { kind: "error", text: result.message },
          });
          break;
      }
    },
    [state.incidents]
  );

  // ── Derive center pane props ────────────────────────────
  const { centerContent, incidents, selectedId, recallResults, isNovelRecall } = state;

  let analysisProps: React.ComponentProps<typeof AnalysisOutput>["incident"] = null;
  const helpMode = centerContent.kind === "help";
  const errorText = centerContent.kind === "error" ? centerContent.text : null;

  if (centerContent.kind === "incident") {
    const inc = incidents.find((i) => i.id === centerContent.id);
    if (inc) {
      analysisProps = {
        triggerType: inc.triggerType,
        severity: inc.severity,
        response: inc.response,
        isLoading: inc.isLoading,
      };
    }
  }

  // ── Render ──────────────────────────────────────────────
  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: "32px 1fr 44px",
        height: "100vh",
        width: "100vw",
        background: "var(--bg)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <HeaderBar connectionStatus={connectionStatus} />

      {/* Body: 3 columns */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "200px 1fr 220px",
          overflow: "hidden",
          borderTop: "none",
        }}
      >
        {/* Left: Incident Feed */}
        <IncidentFeed
          incidents={incidents}
          selectedId={selectedId}
          onSelect={(id) => dispatch({ type: "SELECT_INCIDENT", id })}
        />

        {/* Center: Analysis Output */}
        <AnalysisOutput
          incident={analysisProps}
          helpMode={helpMode}
          errorText={errorText}
        />

        {/* Right: Hindsight Recall */}
        <HindsightRecall incidents={recallResults} isNovel={isNovelRecall} />
      </div>

      {/* Command Bar */}
      <CommandBar
        onSubmit={handleCommand}
        commandHistory={state.commandHistory}
        isLoading={false}
      />
    </div>
  );
}
