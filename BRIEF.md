# Build an AI Personal Stylist & Live Fashion Critic

You are acting as my senior product designer, UX architect, and full-stack engineer.

Build a functioning, mobile-first web application that lets me:

1. Upload and organize my entire wardrobe, jewelry, makeup, shoes, and accessories.
2. Upload reference photos of myself so AI can understand my appearance.
3. Generate creative outfits for real-life occasions using only items I actually own.
4. Produce photorealistic AI-generated images of me wearing those outfits.
5. Speak with a witty, animated AI stylist that can see my actual outfit through my device camera and respond verbally.
6. Record entertaining interactions for my TikTok and YouTube content.

This is initially a private, single-user tool for a seven-day content experiment, but its architecture should support adding features later.

**Prioritize KISS (Keep It Simple, Stupid), single source of truth, modularity, minimal UI complexity, and working functionality over unnecessary technical sophistication.**

Use your installed UI/UX design skill throughout the process.

---

# 1. PRODUCT CONTEXT

I am a college student who already dresses somewhat alternative and expressive.

For seven days, I am giving AI control over my outfits and makeup. The challenge is to push my style beyond combinations I would naturally choose, without deliberately creating costumes or nonsensical looks.

During this week, I will attend classes, have professional coffee chats, and present shoes I have designed to industry professionals.

I want this application to make the experiment easier to execute and produce visually entertaining content.

The core product question is:

**Can AI understand my personal style, push it creatively, and dress me appropriately for real-world situations?**

The app should feel like a premium fashion utility with a sarcastic personality, not a generic AI chatbot.

---

# 2. DESIGN DIRECTION

I will upload images of my desired UI aesthetic.

Analyze these images before designing the interface. Derive a coherent design system from them, including typography, spacing, color, layout, border treatment, controls, and interaction patterns.

My initial preferences:

- Minimal, editorial, contemporary aesthetic.
- Predominantly black, white, and neutral greys.
- Optionally use one strong accent color, such as vivid vermilion/orange, if consistent with my references.
- Strong typography and carefully considered negative space.
- Subtle, functional animations.
- High-quality fashion photography as the primary visual emphasis.
- No generic AI gradients, glowing purple orbs, excessive glassmorphism, or unnecessary futuristic graphics.
- No dashboard clutter or excessive explanatory text.
- Visual hierarchy should prioritize the outfit, not the controls.
- Mobile-first responsive design, also optimized for desktop.

Treat my uploaded design references as the visual authority. If they differ from the aesthetic preferences above, prioritize the references and explain any meaningful conflicts.

Build reusable tokens and components rather than styling each screen independently.

Design all major states: loading, empty, success, failure, active, hover, focus, disabled, and camera/microphone permission states.

Use progressive disclosure. The initial interface should feel extremely simple.

---

# 3. INFORMATION ARCHITECTURE

Create two primary navigation destinations.

## SCREEN 1 — STUDIO

Purpose: Generate, preview, save, and evaluate outfits.

Main interface:

- Large visual outfit preview.
- Prominent "Generate outfit" button.
- Selected occasion/theme.
- Optional contextual instructions.
- AI's chosen clothing and makeup.
- Brief reasoning behind its choices.
- Access to saved looks and the wardrobe library.

The Generate Outfit button should initiate a two-stage process:

**Stage A: Select the outfit**

The AI first chooses a complete outfit using exact items from my saved wardrobe.

Return structured data with item IDs, styling instructions, makeup selections, and reasoning.

Do not begin image generation until this outfit has been successfully validated against my inventory.

**Stage B: Visualize the outfit**

Generate a photorealistic picture of me wearing the selected items, using my uploaded appearance photographs and the original images of the clothing.

Show the result in a large portrait-oriented viewer.

Below it, show the actual reference images for every item used so that I can inspect whether the AI rendered the garments accurately.

Allow:

- Save outfit.
- Regenerate visualization without changing the selected garments.
- Generate a new outfit.
- View exact items.
- View makeup instructions.
- Rate the outfit after wearing it.
- See previously generated looks.

The generated photograph must be clearly distinguished from a real photograph.

### Outfit generation modes

Include an optional selector called "Dressing for..."

Initial presets:

- Everyday / Class
- Date Night — Attract a Boyfriend
- Queer Night Out / Meet a Masc Lesbian
- Professional / Get a Job
- Coffee Chat / Networking
- Make Friends / Approachable
- Creative Industry Event
- Presenting My Work
- Surprise Me
- Custom Occasion

These presets represent styling goals specified by the user, not guarantees about romantic attraction, social success, or how other people will perceive an outfit.

Do not infer another person's sexuality or use stereotypes to decide what they would find attractive.

Each preset should modify the outfit-selection criteria without overriding the established styling rules.

Use a compact selector rather than large cards for every preset.

Let me provide optional context, including location, temperature, schedule, dress code, comfort needs, and any relevant details.

Do not ask for information that has already been provided and remains relevant.

### Wardrobe library

Access the wardrobe library through a clearly labeled but secondary "Closet" control within Studio.

Create a visual catalog with categories:

- Tops
- Bottoms
- Dresses / One-pieces
- Outerwear
- Shoes
- Bags
- Jewelry
- Other Accessories
- Makeup
- Full Looks / Outfit References

Support drag-and-drop and multi-image uploads.

For each item:

- Save the original photograph.
- Allow multiple image angles.
- Automatically suggest category, color, material, pattern, silhouette, and relevant styling attributes using a vision-capable model.
- Let me inspect and correct these attributes before saving.
- Assign a stable item ID.
- Mark items unavailable, archived, or in laundry.
- Support editing, deleting, and searching.
- Preserve original image quality.
- Avoid duplicate records where possible.

For makeup, additionally store product type, shade, finish, and application notes when known.

For photographs containing several clothing items, propose separate inventory items but require confirmation before splitting them into records.

Do not assume an item exists because it appears in a generated image.

### Personal appearance library

Provide an onboarding flow where I can upload:

- Full-body front view.
- Full-body side view.
- Full-body back or three-quarter view.
- Front-facing headshot.
- Left and right three-quarter facial views.
- Optional additional reference images.

Clearly indicate which images are required and which are optional.

Store these as private reference assets.

Allow me to replace or delete individual reference photos.

Do not generate inferred body measurements, sensitive personal attributes, or physical characteristics that cannot be reliably established from the images.

---

# 4. THE AI STYLIST'S DECISION LOGIC

The stylist should use the following persistent behavioral instructions.

You are a creative fashion stylist with an independent perspective.

Your responsibility is to create visually compelling, wearable outfits using only confirmed inventory items.

The user already has a somewhat alternative style. Push beyond their normal choices through:

- Unexpected silhouettes.
- Unconventional layering.
- Contrasting aesthetics.
- Interesting proportions.
- Inventive accessories.
- Thoughtful color combinations.
- Experimental yet intentional makeup.

Aim for approximately 8/10 experimentation unless the user adjusts the creativity setting.

Avoid predictable combinations, but do not intentionally make the user look bad.

Consider:

- Today's occasion and social context.
- Weather and temperature.
- Activity and mobility.
- Actual dress code.
- Available wardrobe items.
- Makeup compatibility.
- Previously generated outfits.
- Feedback from earlier days.
- The user's established style.

Produce ONE final recommendation, not several alternatives.

Choose the outfit before generating its image.

If a garment is unavailable or unsuitable, choose another confirmed item and explain why.

Never hallucinate inventory items.

Keep the creative decision distinct from the image-rendering process.

Track outfit history and user ratings so that later recommendations can incorporate genuine feedback.

The app must not assume that negative feedback about an experimental outfit means the user always wants safer clothing.

---

# 5. PHOTOREALISTIC OUTFIT GENERATION

Use a currently supported OpenAI image-generation API with reference-image inputs.

Consult the current official API documentation before implementation. Do not rely on outdated model names or deprecated endpoints.

For each generation:

1. Retrieve the selected outfit's exact inventory records.
2. Retrieve my relevant appearance-reference photographs.
3. Select the most useful garment reference images.
4. Construct a generation request with clear references to my identity, the clothing, and the desired styling.
5. Generate a realistic portrait photograph.
6. Save the result with its original prompt, selected item IDs, and model metadata.

### Visual quality requirements

- Photorealistic, not illustrated.
- Realistic fabric texture and draping.
- Natural lighting.
- Accurate body proportions.
- Strong preservation of my facial appearance.
- Full-body composition where possible.
- Clear visibility of the complete outfit.
- Consistent, unobtrusive background.
- Appropriate output proportions for vertical social-media content.

Preserve the distinctive colors, patterns, silhouettes, logos, and physical details of the reference garments as closely as the model permits.

Do not silently replace an actual item with a visually similar invented garment.

If identity or clothing fidelity is poor, allow regeneration and show the source-item images for comparison.

Do not promise pixel-perfect virtual try-on. Acknowledge that generated results may differ from the actual clothing or appearance.

Use a provider adapter so that image-generation models can be changed without rewriting the interface or wardrobe database.

Avoid sending the user's entire photo library with every request. Retrieve only the relevant references.

Provide understandable loading indicators, errors, retry behavior, and generation-cost estimates or limits.

---

# 6. SCREEN 2 — MIRROR

Purpose: A conversational, animated AI styling companion that can see my outfit and deliver spontaneous, entertaining reactions.

This screen should feel like I am speaking directly to a character with a distinctive personality.

## The character

Create an original, minimalist animated character representing the application's AI stylist.

My preferred creative direction:

A slightly absurd, deadpan editorial fashion critic represented by a simple monochrome illustrated face.

Visual properties:

- Bold, clean black-and-white graphic shapes.
- Expressive, asymmetrical eyebrows.
- Simple eyes that can widen, narrow, or glance sideways.
- A small mouth with distinct speaking expressions.
- One restrained accent-color detail.
- Minimal enough to feel like a contemporary design object or fashion editorial character.
- Not a realistic human.
- Not a generic robot.
- Not a glowing AI orb.

Its visual personality should be confident, slightly judgmental, and comedically expressive.

Make the character design self-contained and replaceable later.

Use lightweight SVG/CSS animation initially. Do not introduce a 3D engine unless it meaningfully improves the experience.

## Speaking functionality

Implement genuine two-way voice conversation through a currently supported OpenAI realtime audio integration.

The AI should:

- Hear my speech through the microphone after permission is granted.
- Respond verbally through the phone or laptop speaker.
- Handle natural conversational interruptions.
- Maintain context within a session.
- Reference my wardrobe, today's selected outfit, and saved styling preferences.
- Provide optional live captions.
- Support mute and end-session controls.

Connect the character's mouth animation to the output audio signal.

In the first implementation, mouth movement can respond to audio intensity, with simple eye and eyebrow animation for expression.

Do not claim to have accurate phoneme-level lip synchronization if that has not been implemented.

The character should visibly distinguish idle, listening, thinking, speaking, and error states.

## Camera awareness

Add a clear "Turn on camera" action.

When enabled:

- Request camera permission using supported browser APIs.
- Display a camera preview.
- Allow switching between front and rear cameras where supported.
- Allow me to show the AI my outfit, shoes, makeup, or a particular garment.
- Send camera snapshots to a vision-capable OpenAI model so it can comment on visible styling details.
- Relate observations to the outfit the app previously selected.
- React with contextually appropriate spoken responses.

Support an explicit "React to my outfit" button.

This should capture a frame, send it for analysis, and prompt a natural spoken response.

For the initial version, use deliberate snapshots rather than attempting a continuous high-frame-rate video understanding system.

Potential future enhancement: periodic camera-frame analysis during an explicitly activated live observation mode.

Never suggest the AI can see something it has not actually received through the camera or stored images.

Do not interpret facial expressions as reliable evidence of emotions or make speculative claims about a person's identity.

### Reaction recording

Optimize Mirror for content creation.

Include a clean "Creator Mode" that:

- Enlarges the animated character.
- Minimizes unnecessary controls.
- Keeps the user's camera preview visible if desired.
- Optionally displays live captions.
- Provides a clean composition for recording the character reacting to the user's outfit.

For MVP, make the screen compatible with native device screen recording.

If feasible, add an optional in-app recording feature using supported browser media APIs. This must be user-initiated, permission-aware, and tested for browser compatibility.

Do not build a complicated recording pipeline at the expense of working audio and camera interaction.

---

# 7. PERSONALITY AND SASS

The AI stylist should have a distinctly witty, slightly chaotic personality.

Think of a fashion critic who is confident, funny, quick-witted, and occasionally brutally unimpressed.

It should respond conversationally, not with long paragraphs or corporate-sounding explanations.

Create an adjustable sass setting:

- 0 — Professional stylist
- 1 — Friendly and encouraging
- 2 — Playfully sarcastic
- 3 — Sassy fashion critic
- 4 — Maximum dramatic commentary

Default to Level 3.

The sass setting should modify the personality consistently in both written and spoken responses.

Examples of the intended comedic style:

- "Respectfully, what exactly are we attempting here?"
- "Wait. I fear I may have cooked."
- "The silhouette is giving. The shoes are filing a formal complaint."
- "I take full responsibility for this disaster. Unfortunately."

These are examples of tone, not lines to repeat.

Prioritize spontaneous, contextual humor.

Roast styling decisions, garment combinations, or the AI's own recommendations—not someone's body, immutable characteristics, or identity.

Avoid repetitive catchphrases, excessive compliments, and artificially manufactured reactions.

If the outfit looks good, acknowledge it. Do not invent a failure just for humor.

Replies should generally be short enough to produce natural reaction clips, but longer explanations should be available when requested.

---

# 8. TECHNICAL ARCHITECTURE

Recommend the smallest reliable architecture for a private, mobile-first web app.

My preferred starting stack:

- Next.js with TypeScript for frontend and backend routes.
- Tailwind CSS and reusable accessible UI components.
- Supabase for database, private file storage, and authentication.
- OpenAI Responses API for structured styling and vision tasks where appropriate.
- OpenAI image-generation API for realistic outfit previews.
- OpenAI Realtime API over WebRTC for conversational audio.
- Lightweight SVG/CSS for the animated character.

Validate SDKs, endpoint support, and model availability against current documentation.

Do not use deprecated APIs.

Prefer one application codebase with clearly separated modules over multiple independent services.

## Single source of truth

Create a normalized data model supporting:

- User profile and preferences.
- Appearance-reference images.
- Wardrobe items.
- Wardrobe-item photographs.
- Makeup products.
- Styling presets.
- Daily contexts.
- Generated outfits.
- Outfit-to-item relationships.
- Generated outfit images.
- User feedback and ratings.
- Conversation sessions and optional saved transcripts.

Each clothing item should have one authoritative record referenced by its stable ID.

Styling, image generation, saved looks, and Mirror should all reference those same records.

Do not duplicate the entire wardrobe or profile data into separate databases or persist conflicting versions of those values.

## Separation of responsibilities

Organize the application into modules for:

- Inventory management.
- Profile and appearance references.
- Styling decision engine.
- Image-generation provider.
- Voice/conversation provider.
- Camera input.
- Character animation.
- Outfit history and evaluation.

Keep these modules loosely coupled so individual providers and visual components can be replaced later.

## Security and privacy

- Store API credentials only on the server.
- Use short-lived credentials for realtime browser sessions.
- Keep appearance photographs and wardrobe assets in private storage.
- Apply appropriate database and storage access controls.
- Obtain explicit microphone and camera permission.
- Show when the camera or microphone is active.
- Stop media streams when disabled or when the session ends.
- Do not silently record or upload video.
- Allow users to delete their photographs and associated data.
- Avoid unnecessary retention of camera frames and conversation recordings.
- Do not expose private image URLs publicly.

Since this is initially a single-user application, avoid unnecessary multi-user complexity while retaining a secure architecture.

Provide sensible request limits and spend controls for paid image and audio endpoints.

Do not deploy, purchase services, or incur material API costs without my approval.

---

# 9. UX REQUIREMENTS

Design the two main screens around a small number of obvious actions.

Studio:

1. Select an occasion or use the default.
2. Add optional context.
3. Tap Generate Outfit.
4. View the completed look.
5. Save, rate, or regenerate.

Mirror:

1. Open Mirror.
2. Start talking.
3. Optionally enable the camera.
4. Show the outfit.
5. Hear and see the AI react.
6. Stop the session or capture the moment.

Avoid unnecessary onboarding questions, nested menus, confirmations, and settings.

The wardrobe setup is a one-time activity, with lightweight ways to update items later.

For first-time use, provide a clear setup checklist showing what's missing.

Do not present an apparently complete outfit preview if essential reference images or inventory items are unavailable.

Keep the visual appearance polished without sacrificing responsiveness, accessibility, and performance.

---

# 10. IMPLEMENTATION ORDER

Work in stages, validating functionality after each stage.

### Phase 1 — Design system and inventory

- Analyze uploaded design references.
- Establish design tokens and reusable components.
- Create the application shell and responsive navigation.
- Implement appearance-image uploads.
- Implement wardrobe uploads, categorization, editing, and persistence.
- Demonstrate that inventory records and images survive page reloads.

### Phase 2 — AI styling and visualization

- Implement the complete styling rules.
- Connect the styling engine to the real wardrobe database.
- Return validated item IDs and styling instructions.
- Add occasion presets.
- Connect the image-generation provider.
- Save generated looks and user ratings.
- Test the complete generation flow.

### Phase 3 — Interactive Mirror

- Create the animated character.
- Connect realtime spoken conversation.
- Connect camera permission and image capture.
- Implement "React to my outfit."
- Add sass controls and captions.
- Connect Mirror to the same wardrobe and outfit data.
- Test on both desktop and mobile browsers.

### Phase 4 — Refinement and extensibility

- Polish interactions and responsive states.
- Add Creator Mode.
- Improve generation reliability and caching.
- Add error handling and request limits.
- Document extension points for future capabilities.
- Run focused regression tests.

Do not build a complex framework for hypothetical future features. Create clear interfaces between the existing modules instead.

---

# 11. ACCEPTANCE CRITERIA

The app is not complete until the following can be demonstrated:

1. I can upload an item photograph, confirm its category, and find it again after reloading.
2. I can upload multiple reference photos of myself and manage them independently.
3. An outfit request uses only item IDs that exist in my current wardrobe.
4. The AI returns one complete, usable outfit with styling and makeup instructions.
5. I can generate and view a realistic reference-based outfit image through a real API integration.
6. I can save the outfit and see it in my history.
7. My feedback is available to subsequent outfit generations.
8. The Mirror character visibly animates while speaking.
9. I can speak with the AI and hear its response through my device speaker.
10. I can grant camera access, show an outfit, and receive a relevant verbal reaction based on an actual captured image.
11. Camera and microphone permissions can be revoked or disabled without breaking the application.
12. All important workflows function on both mobile and desktop.
13. An API failure does not destroy the user's inventory, saved outfit, or session state.
14. The interface follows my visual references and does not resemble a generic AI dashboard.
15. API credentials are protected, and image storage remains private.

Mock data may be used while building individual interfaces, but the completed workflows must be clearly identified as real, mocked, or blocked.

Do not present simulated image generation, live vision, or spoken responses as functioning integrations.

---

# 12. WORKING INSTRUCTIONS

Start by:

1. Summarizing the simplest viable architecture.
2. Analyzing my uploaded UI references.
3. Identifying which capabilities require real API credentials.
4. Proposing the smallest practical implementation plan.
5. Identifying any genuinely blocking dependencies.

Then implement the application in focused phases.

Do not stop after creating mockups or a design proposal.

Use actual code, persistent data, and real integrations wherever credentials and the environment permit.

If a dependency is missing, build the surrounding functionality, clearly identify the blocked integration, and use a labeled temporary mock only where necessary.

Use focused tests and verify each primary user flow.

Do not overengineer.

Avoid duplicate state, unnecessary abstractions, redundant components, and speculative functionality.

Before declaring the app complete, provide:

- A working local preview.
- A summary of implemented functionality.
- A list of any incomplete integrations.
- Setup instructions.
- Required environment variables.
- Test results.
- A concise architecture overview.

Above all, optimize for a polished, working personal tool that I can use to film my seven-day experiment, not an elaborate demo that only looks functional.
