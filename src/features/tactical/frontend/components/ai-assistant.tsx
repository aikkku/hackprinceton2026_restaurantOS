"use client";

import { Bot, Sparkles, MessageSquare, BarChart2, Lightbulb } from "lucide-react";

export function AiAssistant() {
  return (
    <div className="ai-assistant-page">
      <div className="section-header">
        <div className="section-icon-wrap"><Bot size={20} /></div>
        <div>
          <h2>AI Assistant</h2>
          <p>Your contextual restaurant advisor</p>
        </div>
        <span className="pill pill-warm">Coming soon</span>
      </div>

      <div className="ai-preview-grid">
        <div className="ai-feature-card">
          <span className="ai-feature-icon"><MessageSquare size={22} /></span>
          <h3>Ask anything</h3>
          <p>Ask questions about your floor plan, reviews, or finances. The assistant knows your current layout and operating assumptions.</p>
          <span className="ai-tag">Context-aware</span>
        </div>
        <div className="ai-feature-card">
          <span className="ai-feature-icon"><BarChart2 size={22} /></span>
          <h3>Explain my numbers</h3>
          <p>Get plain-language explanations of your scenario results, revenue trends, and customer signals — with formula transparency.</p>
          <span className="ai-tag">Evidence-cited</span>
        </div>
        <div className="ai-feature-card">
          <span className="ai-feature-icon"><Lightbulb size={22} /></span>
          <h3>Suggest improvements</h3>
          <p>Receive evidence-backed recommendations drawn from review themes, pricing gaps, and layout inefficiencies.</p>
          <span className="ai-tag">Review-grounded</span>
        </div>
        <div className="ai-feature-card">
          <span className="ai-feature-icon"><Sparkles size={22} /></span>
          <h3>Draft responses</h3>
          <p>Generate thoughtful, customizable replies to customer reviews — drafted for your approval, never auto-published.</p>
          <span className="ai-tag">Human-reviewed</span>
        </div>
      </div>

      <div className="ai-placeholder-chat">
        <div className="ai-chat-header">
          <Bot size={18} />
          <span>RestaurantOS AI</span>
          <span className="pill">Inactive</span>
        </div>
        <div className="ai-chat-body">
          <div className="ai-chat-bubble ai-bubble-system">
            The AI assistant is not yet active. When enabled, it will have access to your floor plan, customer reviews, financial data, and operating assumptions to give you grounded, evidence-backed suggestions.
          </div>
        </div>
        <div className="ai-chat-input">
          <input disabled placeholder="Ask about your restaurant…" />
          <button className="button primary compact" disabled>Send</button>
        </div>
      </div>

      <p className="section-footnote">The AI assistant will use only your permitted data. Responses are drafts for review — no actions are taken automatically.</p>
    </div>
  );
}
