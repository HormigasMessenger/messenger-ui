import {describe, it, expect, vi} from "vitest";
import {extractFieldErrors, findInputNode, findHiddenNodes, isInputNode, handleFlowError} from "../kratosFlows";
import type {UiNode} from "@ory/client";

// The flow fns (init/submit/logout) hit the kratos client — mock it away so importing the module is
// side-effect-free. Only the PURE helpers below are exercised.
vi.mock("../kratos", () => ({kratos: {}}));

const input = (name: string, type = "text", messages: {id: number; text: string}[] = []): UiNode => ({
    type: "input",
    group: "default",
    attributes: {name, type, node_type: "input"},
    messages,
    meta: {},
} as unknown as UiNode);

const textNode = (): UiNode => ({type: "text", group: "default", attributes: {}, messages: [], meta: {}} as unknown as UiNode);

describe("kratosFlows pure helpers", () => {
    it("extractFieldErrors collects messages for the named input only", () => {
        const flow = {ui: {nodes: [
            input("password", "password", [{id: 1, text: "too short"}]),
            input("identifier", "text", [{id: 2, text: "required"}]),
        ]}};
        expect(extractFieldErrors(flow, "password").map((m) => m.text)).toEqual(["too short"]);
        expect(extractFieldErrors(flow, "missing")).toEqual([]);
    });

    it("findInputNode / findHiddenNodes / isInputNode select the right nodes", () => {
        const nodes = [textNode(), input("csrf_token", "hidden"), input("identifier", "text")];
        const flow = {ui: {nodes}} as Parameters<typeof findInputNode>[0];
        expect(findInputNode(flow, "identifier")).toBe(nodes[2]);
        expect(findInputNode(flow, "nope")).toBeUndefined();
        expect(findHiddenNodes(flow)).toEqual([nodes[1]]);
        expect(isInputNode(nodes[1])).toBe(true);
        expect(isInputNode(nodes[0])).toBe(false);
    });

    it("handleFlowError: 410 recreates the flow, otherwise sets the response body", () => {
        const recreate = vi.fn(async () => ({ui: {nodes: []}}));
        const setFlow = vi.fn();

        handleFlowError({response: {status: 410}}, recreate, setFlow);
        expect(recreate).toHaveBeenCalledTimes(1);

        const body = {ui: {nodes: [input("x")]}};
        handleFlowError({response: {status: 400, data: body}}, recreate, setFlow);
        expect(setFlow).toHaveBeenCalledWith(body);
    });
});
