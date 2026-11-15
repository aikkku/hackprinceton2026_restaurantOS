# RestaurantOS — Tactical Platform: Product Refinement and Implementation

You are working on **RestaurantOS**, an AI-powered restaurant management and business intelligence platform built for HackPrinceton Fall 2026.

We already have an existing codebase, design system, and partially implemented features. **Do not rebuild the application from scratch.** Your task is to inspect what already exists, preserve working functionality, and evolve the Tactical side into the product described below.

## 0. Read the existing project first

Before making changes, read:

- Root `AGENTS.md`
- `docs/GAME_DESIGN.md`
- `src/features/tactical/AGENTS.md`
- `docs/tactical/TACTICAL_SPEC.md`
- Existing shared contracts and relevant project documentation

Inspect the actual repository structure, routes, components, data models, and existing implementations.

Identify what is already working, what can be reused, and what is missing.

**Important architectural constraints:**

- One Next.js repository shared between two developers.
- Asilbek owns Tactical; Rain owns Expansion.
- Do not modify Rain's Expansion implementation without a necessary shared-contract change.
- Reuse the existing component library, design tokens, application shell, and AI infrastructure.
- Preserve the existing 2D restaurant floor-plan editor.
- Do not introduce a second design system or a new application architecture.
- Prefer extending working components over replacing them.

Produce a concise implementation plan, then begin working through it in priority order.

---

# 1. Overall Product Vision

RestaurantOS should feel like a **lightweight restaurant management simulator backed by real business analytics**.

We want the engaging, interactive nature of a restaurant management game, but we do not want to create an actual entertainment game.

Our primary audience is independent restaurant owners and managers.

The user should be able to:

1. See and modify a visual representation of their restaurant.
2. Understand their customers through reviews and social media.
3. Explore staffing and supply information.
4. Understand their finances and potential improvements.
5. Experiment with business decisions before implementing them.
6. Receive contextual AI recommendations based on their actual business data.

## Design philosophy

Keep the existing game-inspired visual direction.

- Simple 2D or subtle 2.5D restaurant scenes.
- Friendly, colorful, polished visuals.
- Interactive objects, cards, and scenario previews.
- Smooth but restrained animations.
- Professional and readable data visualizations.
- Avoid cluttered game interfaces, excessive gamification, or cartoonish business metrics.
- No need for full 3D models or a game engine.

**Simple by default, advanced on demand.**

The main interface should communicate information visually. Detailed assumptions, financial formulas, data sources, confidence levels, and analysis should be accessible through expandable panels or drawers.

Maintain shared visual consistency with Expansion.

---

# 2. Required Tactical Navigation

The Tactical platform must contain these sections:

1. **Floor Plan** — primary landing page
2. **Customer Reviews & Social Media**
3. **HR**
4. **Supply Management**
5. **Financial Intelligence**
6. **AI Assistant** — future placeholder

Preserve the existing Strategic/Expansion module and its navigation.

Do not create unnecessary extra top-level pages. In particular, **Scenarios must be integrated directly into Floor Plan**, not remain a separate standalone experience.

All Tactical pages should operate on the same selected restaurant profile.

---

# 3. Floor Plan — Primary Feature

**Priority: Critical**

This is the visual centerpiece of the Tactical platform.

It should look polished, interactive, and attractive enough to serve as the main demo page.

The current floor-plan editor is already partially implemented. Inspect and improve it rather than rewriting everything.

## 3.1 Restaurant layout editor

The restaurant manager must be able to create a representation of their actual restaurant.

Required capabilities:

- Add, move, rotate, and remove furniture.
- Add tables, chairs, counters, walls, doors, windows, plants, decorations, and lighting.
- Add **air-conditioning units (AC)** as a supported object type.
- Maintain an editable 2D canvas.
- Show seating capacity and relevant layout information.
- Preserve existing editing controls and functionality.

Support custom objects.

A manager should be able to describe an object, for example:

> "A large refrigerator next to the kitchen entrance."

The system should create a customizable object with an appropriate name, visual representation, dimensions, and description.

The manager should be able to edit its position, dimensions, rotation, and metadata.

Where useful, AI may suggest a category or semantic properties for the object, but the user controls the actual placement.

This custom-object information should be available to later AI analysis.

## 3.2 Multiple saved layouts

Add the ability to save different floor-plan configurations.

Required capabilities:

- Save the current layout.
- Name and rename saved layouts.
- Duplicate existing layouts.
- Switch between layouts.
- Delete saved layouts with confirmation.
- Mark one layout as the current/baseline layout.
- Preserve furniture placement and object metadata.

Example saved layouts:

- Current Restaurant
- High Capacity
- Comfortable Dining
- Proposed Renovation

Store layouts persistently using the existing application storage architecture.

Do not lose existing layouts when switching between configurations.

## 3.3 Floor-plan analytics

The platform should help answer:

- Why do customers prefer certain seats?
- Which seating areas might be uncomfortable?
- How should tables be arranged?
- Is adding more seating financially beneficial?
- Is a more spacious, aesthetic layout preferable to a denser layout?
- How do customer volume and dining duration affect seating requirements?

Support these metrics where data is available:

- Customer arrivals and estimated foot traffic.
- Customer dining duration.
- Average dine-in spending.
- Table turnover.
- Occupancy and seating utilization.
- Estimated revenue per occupied seat or table.
- Peak and off-peak demand.

Possible data sources:

- Imported POS/cashier transactions.
- Transaction timestamps and amounts.
- Transaction type: dine-in, delivery, or takeaway.
- Table assignment and service start/end information, if available.
- Google Maps popular/busy-times information, where legitimately accessible.
- Uploaded restaurant operational data.

**Important:** Do not assume that Google Maps provides individual customer counts, dining durations, or per-seat behavior. Popular-times information is aggregated, and POS timestamps alone do not establish how long a customer occupied a seat.

Build flexible data adapters and support uploaded CSV files or clearly labeled demo data. Only calculate metrics that the available information actually supports.

## 3.4 Seating preference analysis

Use AI to analyze potential reasons some seating areas may be more attractive.

Consider:

- Proximity to windows.
- Lighting.
- AC placement.
- Distance from entrances.
- Nearby kitchen or high-traffic areas.
- Privacy and spacing.
- Customer reviews mentioning the interior.
- Actual table-level usage data, if available.

For example:

> "Customers may prefer tables near the windows because they receive natural light and are farther from the entrance."

Such explanations must be presented as hypotheses unless supported by actual observed behavior or customer feedback.

Show evidence where available and communicate uncertainty.

Allow managers to click an area or table to inspect its attributes and related insights.

## 3.5 Aesthetic versus capacity tradeoff

Provide a simple interactive comparison between:

- Spacious and comfortable layout.
- Balanced layout.
- Higher-density seating layout.

The user should be able to compare saved layouts using available or calculated metrics.

Examples:

- Number of seats.
- Table spacing.
- Estimated utilization.
- Potential revenue.
- Investment cost.
- Layout constraints.
- Customer comfort indicators where evidence exists.

Avoid claiming that AI can objectively measure aesthetics or customer satisfaction from geometry alone.

Use explicitly defined layout heuristics and user preferences.

## 3.6 Integrate AI Scenarios into Floor Plan

There should **not** be a separate Scenarios page.

Instead, integrate a Scenarios/Insights panel within the Floor Plan experience.

AI should identify potential improvements or problems and display them as contextual cards.

Use three severity levels:

**Gray — Suggestions**
- Optional improvement opportunities.
- Ideas worth exploring.
- Minor layout optimizations.

**Yellow — Potential problems**
- Possible operational inefficiencies.
- Areas that may be uncomfortable.
- Seating or traffic-flow concerns requiring investigation.

**Red — Critical problems**
- Clearly supported serious issues requiring attention.
- Use this level conservatively.
- Never claim a fire-code, accessibility, or safety violation without appropriate authoritative evidence and applicable rules.

Examples:

- Potential congestion near the restaurant entrance.
- AC airflow or placement worth reviewing.
- Tables positioned close to a busy service path.
- Opportunity to increase capacity.
- Potentially inefficient table distribution.
- Negative interior-related reviews.

Each scenario should include:

- Title and severity.
- Affected objects or areas, if applicable.
- Explanation.
- Supporting evidence or stated heuristic.
- Suggested action.
- Estimated financial impact, if calculable.
- Ability to preview the proposed change.

When possible, clicking a scenario should highlight the affected area on the floor plan.

The manager must always have control over accepting or rejecting changes.

## 3.7 CoStar track alignment

Floor Plan is one of our intended CoStar-related experiences.

Where CoStar provides relevant authorized commercial building/property information, use it to enrich the restaurant's physical-space analysis.

However:

- Do not assume CoStar provides restaurant table-level data or existing interior geometry.
- Do not fabricate CoStar building details.
- Keep the CoStar adapter separate from the editor.
- Use manual/imported floor plans when the relevant building data is unavailable.
- Preserve the opportunity for Rain's Expansion module to reuse commercial property information.

The Floor Plan must remain fully functional even without CoStar API access.

---

# 4. Customer Reviews & Social Media

**Priority: High**

This is our main customer-intelligence feature and a major opportunity for the **Arlequin track**.

The page should combine customer feedback, social engagement, menu intelligence, and AI-generated recommendations.

## 4.1 Customer feedback overview

Answer:

- What do customers like most?
- What do customers dislike most?
- Which dishes receive the most praise or criticism?
- What are the most common complaints?
- How has customer sentiment changed over time?
- Are there different patterns across platforms?

Display:

- Overall review distribution.
- Positive versus negative feedback.
- Main customer sentiment themes.
- Most mentioned dishes.
- Trends over time.
- Source/platform comparisons.
- Relevant engagement metrics.

Use clean, consistent charts and expandable explanations.

## 4.2 Review collection and filtering

Support authorized data imports and existing integrations.

Allow filtering by:

- Review source or social platform.
- Positive, neutral, or negative sentiment.
- Date range.
- Author/person where available.
- Mentioned dish.
- Topic or keyword.

Retain source information so AI findings can be traced back to the underlying reviews.

If author contact information is legitimately available, display only the information publicly shared for that purpose or supplied with authorization.

Do not scrape private contact details, infer email addresses, or attempt to identify anonymous reviewers.

## 4.3 Menu intelligence

Analyze customer feedback about specific menu items.

Provide:

- Most positively mentioned dishes.
- Most negatively mentioned dishes.
- Changes in dish popularity over time.
- Potential opportunities to improve menu descriptions or presentation.
- Potential pricing opportunities when cost and sales information is available.

Distinguish **review popularity** from actual sales volume.

Do not treat the number of favorable reviews as an accurate measurement of revenue or demand.

## 4.4 AI researcher

Implement an AI analysis workflow that identifies improvement opportunities from the available feedback.

It should produce:

- Summary of significant findings.
- Suggested operational or menu improvements.
- Supporting reviews.
- Potential financial implications.
- Potential implementation costs.
- Confidence and missing information.

For costs, prefer provided estimates, supplier information, or transparent assumptions. If there is insufficient data, say that the cost is unknown rather than inventing a precise number.

## 4.5 Historical changes

The application should explain how customer feedback changes over time.

Examples:

- Service complaints increased in the most recent review period.
- A dish has received more favorable mentions recently.
- Interior-related feedback has improved or worsened.

Support comparisons between date ranges, with sample sizes visible.

AI should distinguish actual trends from insufficient evidence.

## 4.6 Social media and marketing intelligence

Compare activity across supported sources.

Analyze:

- Engagement by platform.
- Topics that attract attention.
- Popular posts or dishes.
- Content themes.
- Potential marketing opportunities.

For the Arlequin challenge, where data permits, build an actual interaction/network analysis using observed relationships such as authors, posts, mentions, hashtags, and engagement links.

Do not fabricate relationships or claim network-analysis functionality if only sentiment classification has been implemented.

## 4.7 AI-assisted responses

Allow the manager to generate suggested replies to customer reviews and comments.

The assistant should:

- Understand the original review.
- Consider the restaurant's context.
- Generate a natural, professional response.
- Adapt to positive or negative feedback.
- Allow manual editing.

**Do not automatically publish responses.**

Publishing should require explicit user confirmation and a supported authorized platform integration.

If posting APIs are unavailable, provide a copyable draft.

---

# 5. HR

**Priority: Mock/demo page only**

Build a polished page using clearly labeled fictional data.

We are not implementing a complete HR system for this hackathon.

Display:

- Employee directory.
- Names and roles.
- Contact information.
- Pay rates.
- Scheduled hours.
- Estimated labor costs.
- Employee availability.
- Employee mood or self-reported satisfaction, as fictional demonstration data.

Use realistic but synthetic employee records.

The page should look consistent with RestaurantOS and should be navigable, but advanced backend functionality is not required.

Include a concept for an AI-assisted Indeed job posting workflow:

- Generate a job description.
- Suggest improvements to a draft.
- Preview the posting.

Do not actually publish a job or claim Indeed integration unless it has been implemented and authorized.

---

# 6. Supply Management

**Priority: Mock/demo page only**

Build a visually polished supply management page using clearly labeled synthetic data.

Display:

- Current inventory.
- Product names and categories.
- Stock quantities.
- Reorder thresholds.
- Supplier/distributor directory.
- Distributor contact information.
- Estimated product costs.
- Items approaching their reorder point.

Provide a simple AI-inspired restock summary.

Example:

> "Three products are below their reorder thresholds. Distributor A is associated with two of them."

For the MVP, rule-based calculations and pre-generated demo insights are acceptable, as long as the page does not pretend to use a live AI model or connected inventory system.

Use fictional suppliers and contact details.

Do not spend significant time building purchasing, ordering, logistics, or supplier integrations.

---

# 7. Financial Intelligence

**Priority: Critical**

This should be one of the strongest, most functional pages in RestaurantOS.

It is also important for multiple sponsor tracks, especially **Capital One Nessie** and AI-assisted business optimization.

The interface should combine a financial dashboard, accounting-style data tables, menu pricing analysis, and scenario calculations.

## 7.1 Financial overview

Display relevant financial indicators:

- Revenue.
- Expenses.
- Gross profit.
- Operating profit or estimated contribution.
- Cash balance, if supported.
- Average order value.
- Dine-in versus delivery revenue.
- Cost breakdown.
- Revenue trends.

Each figure must have a clear calculation and data source.

Do not confuse revenue, cash flow, gross profit, and net profit.

## 7.2 Accounting-style transaction table

Provide a professional, editable or filterable accounting-style view.

Fields may include:

- Date.
- Description.
- Category.
- Amount.
- Income/expense type.
- Payment or transaction source.
- Dine-in/delivery/takeaway classification.

Use demo data initially, clearly labeled.

Allow filtering, sorting, and summary calculations.

Design the data layer so imported or connected financial records can replace demo records later.

## 7.3 Menu pricing analysis

This is a high-priority feature.

For each menu item, display:

- Item name.
- Current dine-in price.
- Current delivery price.
- Estimated ingredient or preparation cost, if known.
- Historical sales quantity, if available.
- Contribution margin.
- Suggested price or suggested price range.
- Reasoning behind the recommendation.

Suggested prices should consider supported factors such as:

- Actual item costs.
- Historical sales.
- Customer feedback.
- Competitor pricing.
- Restaurant goals.
- Delivery fees and other channel-specific costs.

AI can propose candidate prices or explain tradeoffs, but numeric recommendations must be evaluated through explicit calculations and assumptions.

Avoid presenting unsupported price recommendations as guaranteed profit improvements.

## 7.4 Competitor pricing

Allow comparison with prices for similar dishes at other restaurants.

Display:

- Competitor or source name.
- Comparable menu item.
- Listed price.
- Date of observation.
- Source or method of collection.

Use verified public information, licensed data, user imports, or clearly labeled sample data.

Do not invent current competitors' prices.

Make clear when menu items are only approximate comparisons.

## 7.5 Delivery versus dine-in

Support different prices and cost structures for delivery and dine-in.

Allow analysis of:

- Menu price differences.
- Platform commission or delivery fees.
- Packaging costs.
- Channel-specific revenue.
- Channel contribution margins.
- Potential pricing changes.

A restaurant may charge different prices across these channels.

The software should allow scenario comparisons without assuming they have identical costs.

## 7.6 Financial simulator

Integrate interactive financial scenarios directly into the Financial Intelligence page.

Examples:

- Increase a menu item's price by 5%.
- Add additional seating.
- Invest in a dining-room renovation.
- Change delivery pricing.
- Compare operating cost assumptions.
- Evaluate break-even requirements.

Use deterministic TypeScript functions for calculations.

AI should explain the results, not invent the results.

Allow the user to modify assumptions and compare saved scenarios.

## 7.7 Capital One Nessie integration

Implement a separate data adapter for the Nessie sandbox API if credentials and required endpoints are available.

Potential usage:

- Simulated accounts.
- Bills.
- Transactions.
- Merchant data.
- Cash-flow analysis.
- Investment feasibility scenarios.

Do not imply that Nessie demo data is the restaurant's real banking information.

If API access is unavailable, use labeled fixtures while keeping the adapter interface ready for integration.

A demo using only local fixtures should not be claimed as a completed Nessie integration.

---

# 8. AI Assistant

**Priority: Placeholder only**

Keep the AI Assistant in the navigation.

Create a polished placeholder screen communicating that a restaurant-wide business advisor is planned.

Do not spend time developing a full assistant yet.

The future assistant should be able to access:

- Restaurant profile.
- Floor-plan configurations.
- Customer analysis.
- Financial data.
- Supply information.
- Expansion insights.

However, no full chat functionality is required in this implementation.

Prioritize contextual AI features inside existing pages instead.

---

# 9. Shared AI Architecture

We do not want RestaurantOS to be just another AI chatbot.

AI must be integrated naturally into the platform.

Our desired pattern is:

**Business data → structured AI interpretation → actionable finding → interactive scenario → explainable outcome.**

Implement reusable AI service interfaces where appropriate.

Prefer:

- Structured JSON outputs validated by Zod.
- Evidence-linked recommendations.
- Deterministic financial calculations.
- Explicit data provenance.
- Clear separation of observed facts, estimates, and hypotheses.
- Cached or persisted analysis results where useful.
- Graceful handling of missing API keys and failed requests.

Do not fabricate analysis results or display mocked AI output as live analysis.

Do not embed API keys in client-side code.

Every AI-driven recommendation should ideally contain:

- Finding.
- Evidence.
- Suggested action.
- Priority or severity.
- Confidence or uncertainty.
- Assumptions.
- Optional financial scenario.
- Relevant page or object reference.

Where possible, recommendations should connect across modules.

For example, a review complaining about the restaurant's interior may generate a recommendation that links directly to the Floor Plan.

---

# 10. Shared Game Design and UX Requirements

Keep RestaurantOS's playful 2D simulation aesthetic.

However, the platform must remain practical for actual restaurant owners.

Requirements:

- Floor Plan is the flagship interactive experience.
- Other pages can be more data-oriented.
- Shared navigation, typography, colors, cards, buttons, and panels.
- Subtle animations and interactive feedback.
- No excessive game scores or fictional business metrics presented as facts.
- Advanced analysis should be hidden by default but easily accessible.
- Clear distinctions between simulated outcomes and observed data.
- Responsive layouts.
- Consistent empty, loading, error, and demo states.

The HR, Supply, Reviews, and Finance pages must all visually belong to the same application.

Use existing shared components instead of inventing new component styles on every page.

---

# 11. HackPrinceton Track Alignment

The implementation should preserve the following track objectives.

| Track | Relevant feature | Technical contribution |
|---|---|---|
| Business & Enterprise | RestaurantOS overall | Operational optimization and business decision support |
| CoStar Group | Floor Plan + Expansion | Relevant commercial property/building data, space analysis, and site selection |
| Arlequin | Customer Reviews & Social Media | Content classification and observed engagement/network analysis |
| Capital One Nessie | Financial Intelligence | Sandbox banking transactions and financial scenarios |
| Amazon AI | Cross-platform AI analysis | AI-generated insights and actionable recommendations; verify exact sponsor requirements |
| Peri Forward Deployed | Whole platform | Product adaptation to a real restaurant's identified business problem, handled with the outreach team |

Important:

**Sponsor alignment must be based on working features and actual qualifying integrations, not just visual similarity or conceptual relevance.**

Do not misrepresent mock data, unavailable APIs, or unsupported analysis as a completed sponsor requirement.

---

# 12. Technical and Development Constraints

Stay aligned with the existing application architecture.

Preferred technologies, unless the repository already has an equivalent:

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
- Zod
- Existing database and storage configuration
- Recharts for analytics
- Existing floor-plan canvas implementation
- Existing AI provider integration

Do not introduce unnecessary dependencies.

Use shared domain types for restaurants, data sources, evidence, analyses, recommendations, layouts, scenarios, and financial records.

Keep feature-specific implementation inside the Tactical module.

Shared files should be modified cautiously because Rain is independently developing Expansion.

Preserve compatibility with the shared root `AGENTS.md`, existing contracts, and `docs/GAME_DESIGN.md`.

---

# 13. Implementation Priorities

We have limited hackathon time, so implement in this order.

## P0 — Core functionality

1. Refine navigation and make Floor Plan the primary Tactical page.
2. Preserve and improve the existing editable floor-plan canvas.
3. Add named, persistent floor-plan configurations.
4. Add AC units and customizable objects.
5. Integrate the Scenarios experience into Floor Plan.
6. Build real customer-review analysis from imported or available data.
7. Build the Financial Intelligence dashboard, transaction model, and pricing comparison.
8. Connect financial simulations to existing restaurant and floor-plan assumptions.

## P1 — Intelligence and sponsor features

1. AI analysis of floor-plan characteristics and interior reviews.
2. Review trends, menu sentiment, and marketing opportunities.
3. AI researcher generating evidence-backed recommendations.
4. Real Arlequin-specific network analysis if usable source data is available.
5. Nessie sandbox API integration if credentials are available.
6. CoStar data integration where relevant and supported.
7. AI-assisted review reply drafting.

## P2 — Supporting pages and polish

1. HR demo page.
2. Supply Management demo page.
3. AI Assistant placeholder.
4. Animation and styling polish.
5. Final cross-page navigation and data consistency.

All required sections should be accessible, but prioritize functional depth in Floor Plan, Customer Intelligence, and Financial Intelligence.

---

# 14. Definition of Done

Before considering this task finished:

- All six required Tactical sections exist in navigation.
- Existing Expansion functionality remains intact.
- Floor Plan supports manual editing and named saved layouts.
- AC units and custom objects are supported.
- Scenarios are integrated into Floor Plan instead of duplicated elsewhere.
- Review analysis works with provided or imported datasets.
- Financial analytics use explicit formulas.
- Menu pricing supports dine-in and delivery differences.
- HR and Supply are clearly labeled demo experiences.
- AI Assistant is intentionally a placeholder.
- Shared styles and components remain consistent.
- Real data and mock data are clearly distinguished.
- No fabricated API integrations or business metrics.
- TypeScript compilation, linting, relevant tests, and build pass.

Test the primary user journeys, not just isolated components.

Report any functionality that could not be completed.

---

# 15. Your Immediate Task

First, inspect the current implementation and identify how it differs from the target product.

Then:

1. Provide a concise gap analysis.
2. Identify the existing components that should be reused.
3. Establish an implementation order with minimal disruption.
4. Start implementing the highest-priority missing functionality.
5. Verify each major feature before moving to the next.
6. Keep the repository working throughout development.

**Do not stop after proposing a plan. Begin implementation.**

Do not rewrite functioning features unnecessarily.

Work incrementally, respect the existing architecture, and use the available project context.

At the end, summarize:

- Features implemented.
- Existing functionality preserved.
- Files changed.
- Tests completed.
- External integrations actually working.
- Features still using demo data.
- Remaining work, prioritized by importance.

The final result should feel like **a single intelligent restaurant operating system**, not a collection of disconnected dashboards.

The main objective is to make restaurant management more visual, interactive, and understandable while retaining the depth needed for real business decisions.