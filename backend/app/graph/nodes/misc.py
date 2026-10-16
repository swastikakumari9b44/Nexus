from langchain_core.messages import AIMessage

from app.graph.state import AgentState

HELP = ("I can answer questions about the Employee Handbook (with page citations) or help you book "
        "a Performance Review session. What would you like to do?")


async def clarify(state: AgentState) -> dict:
    return {"reply_parts": [HELP], "trace": list(state.get("trace") or []) + ["clarify"],
            "active_node": "clarify"}


async def finalize(state: AgentState) -> dict:
    reply = "\n\n".join(p for p in (state.get("reply_parts") or []) if p).strip() or HELP
    trace = list(state.get("trace") or []) + ["finalize"]
    msg = AIMessage(content=reply, additional_kwargs={
        "citations": state.get("citations") or [], "trace": trace, "intent": state.get("intent")})
    return {"messages": [msg], "reply": reply, "trace": trace, "active_node": "finalize"}
