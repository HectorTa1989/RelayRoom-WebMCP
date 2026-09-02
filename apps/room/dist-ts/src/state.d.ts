import type { ConstraintEvidence, RecoveryCandidate, StagedTransaction, ToolAuditEvent } from '@relayroom/contracts';
import type { DiscoveredTool } from '@relayroom/ui';
import type { RuntimeMode } from './orchestration';
export type RoomStage = 'ready' | 'querying' | 'simulating' | 'preview' | 'staging' | 'staged' | 'executing' | 'success' | 'rollback';
export type RoomState = {
    stage: RoomStage;
    mode: RuntimeMode;
    tools: DiscoveredTool[];
    evidence: ConstraintEvidence[];
    candidates: RecoveryCandidate[];
    selected?: RecoveryCandidate;
    transaction?: StagedTransaction;
    audit: ToolAuditEvent[];
    error?: string;
    partnerPulse?: 'buyer' | 'supplier' | 'carrier';
    failureRehearsal: boolean;
    planner?: {
        source: 'openai' | 'gemini' | 'deterministic';
        model?: string;
        narrative: string;
        fallbackReason?: string;
    };
};
export declare const initialRoomState: RoomState;
export type RoomAction = {
    type: 'reset';
} | {
    type: 'stage';
    stage: RoomStage;
} | {
    type: 'tools';
    tools: DiscoveredTool[];
    mode: RuntimeMode;
} | {
    type: 'evidence';
    evidence: ConstraintEvidence;
} | {
    type: 'candidates';
    candidates: RecoveryCandidate[];
} | {
    type: 'select';
    candidate: RecoveryCandidate;
    transaction: StagedTransaction;
} | {
    type: 'transaction';
    transaction: StagedTransaction;
} | {
    type: 'audit';
    event: ToolAuditEvent;
} | {
    type: 'pulse';
    partner?: 'buyer' | 'supplier' | 'carrier';
} | {
    type: 'error';
    message?: string;
} | {
    type: 'failure';
    enabled: boolean;
} | {
    type: 'planner';
    planner: NonNullable<RoomState['planner']>;
};
export declare function roomReducer(state: RoomState, action: RoomAction): RoomState;
