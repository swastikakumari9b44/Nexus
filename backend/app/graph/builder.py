from langgraph.graph import END, START, StateGraph

from .deps import GraphDeps
from .nodes.booking import make_booking
from .nodes.misc import clarify, finalize
from .nodes.rag import make_rag
from .nodes.router import make_router
from .routing import after_rag, after_router
from .state import AgentState


def build_graph(deps: GraphDeps, checkpointer):
    g = StateGraph(AgentState)
    g.add_node("router", make_router(deps))
    g.add_node("rag", make_rag(deps))
    g.add_node("booking", make_booking(deps))
    g.add_node("clarify", clarify)
    g.add_node("finalize", finalize)
    g.add_edge(START, "router")
    g.add_conditional_edges("router", after_router,
                            {"rag": "rag", "booking": "booking", "clarify": "clarify", "finalize": "finalize"})
    g.add_conditional_edges("rag", after_rag, {"booking": "booking", "finalize": "finalize"})
    g.add_edge("booking", "finalize")
    g.add_edge("clarify", "finalize")
    g.add_edge("finalize", END)
    return g.compile(checkpointer=checkpointer)
