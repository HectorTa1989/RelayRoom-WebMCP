export const initialRoomState = {
    stage: 'ready', mode: 'bridge', tools: [], evidence: [], candidates: [], audit: [], failureRehearsal: false,
};
export function roomReducer(state, action) {
    switch (action.type) {
        case 'reset': return initialRoomState;
        case 'stage': return { ...state, stage: action.stage };
        case 'tools': return { ...state, tools: action.tools, mode: action.mode };
        case 'evidence': return { ...state, evidence: [...state.evidence.filter((item) => item.origin !== action.evidence.origin), action.evidence] };
        case 'candidates': return { ...state, candidates: action.candidates };
        case 'select': return { ...state, selected: action.candidate, transaction: action.transaction, stage: 'preview' };
        case 'transaction': return { ...state, transaction: action.transaction };
        case 'audit': return { ...state, audit: [action.event, ...state.audit] };
        case 'pulse': return { ...state, partnerPulse: action.partner };
        case 'error': return { ...state, error: action.message };
        case 'failure': return { ...state, failureRehearsal: action.enabled };
        case 'planner': return { ...state, planner: action.planner };
        default: return state;
    }
}
