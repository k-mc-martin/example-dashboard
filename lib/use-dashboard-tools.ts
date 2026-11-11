"use client";
import { useEffect } from "react";
/** Navigation only: no customer data or external account actions are exposed. */
export function useDashboardTools(setView: (value:string)=>void, sections: readonly string[]) {
  useEffect(() => {
    const context = (document as Document & {modelContext?: {registerTool: (tool:object, options:{signal:AbortSignal})=>unknown}}).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      Promise.resolve(context.registerTool({
        name: "show_dashboard_section",
        title: "Show dashboard section",
        description: "Open an available dashboard section.",
        inputSchema: {type:"object",properties:{section:{type:"string",enum:sections}},required:["section"],additionalProperties:false},
        annotations: {readOnlyHint:true,untrustedContentHint:false},
        async execute(input:unknown) {
          const value=input as {section?:unknown};
          if (!value || Object.keys(value).length !== 1 || typeof value.section !== 'string' || !sections.includes(value.section)) throw new Error('Choose an available section.');
          setView(value.section);
          await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
          return {section:value.section};
        },
      },{signal:lifecycle.signal})).catch(()=>{});
    } catch { /* Browsers without supported registration still use normal controls. */ }
    return ()=>lifecycle.abort();
  }, [setView, sections]);
}
