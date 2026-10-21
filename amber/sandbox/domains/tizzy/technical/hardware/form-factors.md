# Form Factor Design Options

**Document Version:** 1.0
**Last Updated:** February 13, 2026
**Audience:** Product, Hardware Engineering, Industrial Design

---

## Overview

This document explores form factor options for Tizzy's always-wearable conversation coach. The V1 form factor is a necklace pendant, but long-term success requires evaluating alternative designs for different user preferences, use cases, and aesthetic considerations. Each form factor is evaluated on: audio quality, battery life, social acceptance, comfort, cost, and technical feasibility.

---

## Form Factor Selection Criteria

| Criterion | Weight | Description |
|-----------|--------|-------------|
| **Audio Quality** | 30% | Proximity to mouth, noise rejection, under-clothing performance |
| **Battery Life** | 20% | Physical space for battery, power budget constraints |
| **Social Acceptance** | 20% | Visibility, stigma, "wearing a wire" perception |
| **Comfort** | 15% | All-day wearability, weight distribution, skin irritation |
| **Cost** | 10% | Manufacturing complexity, BOM cost at 10K volume |
| **Technical Feasibility** | 5% | R&D risk, time to market |

---

## Form Factor 1: Necklace Pendant (V1 Primary)

### Description
Circular or oval pendant worn on adjustable cord (40-60cm), similar to Limitless Pendant or Friend. Device hangs at collarbone level, can be worn under or over clothing.

### Specifications
- **Dimensions:** 30-40mm diameter, 8-12mm thickness
- **Weight:** ≤25g
- **Materials:** Medical-grade silicone or anodized aluminum
- **Cord:** Adjustable silicone or woven nylon, breakaway mechanism

### Diagram (Text-Based)
```
      ┌─────────┐
      │   Cord  │ (adjustable length 40-60cm)
      └────┬────┘
           │
      ┌────▼────┐
      │ ┌─────┐ │
      │ │ LED │ │ (edge-mounted, visible indicator)
      │ └─────┘ │
      │  Device │ (pendant body, 30-40mm diameter)
      │ ┌─────┐ │
      │ │ Btn │ │ (button, accessible through clothing)
      │ └─────┘ │
      └─────────┘
```

### Pros
✓ **Proximity to Mouth:** 20-30cm distance optimal for audio capture
✓ **Battery Space:** 600mAh possible in 40mm x 10mm form factor
✓ **Cord Conceal:** Can wear under shirt for discretion
✓ **Mature Technology:** Similar form factors already validated (Limitless, Friend)
✓ **Low Cost:** Simple mechanical design, off-the-shelf components

### Cons
✗ **Under-Clothing Muffling:** Fabric attenuates audio (requires DSP compensation)
✗ **Necklace Stigma:** Some users uncomfortable wearing necklaces (gendered perception)
✗ **Cord Tangling:** Cord can catch on objects, uncomfortable during sleep if worn
✗ **Limited Aesthetics:** "Tech pendant" look may still signal assistive device

### Audio Performance
- **Under Clothing:** Intelligibility reduced 15-20% (fabric filtering)
- **Wind Noise:** Moderate (exposed when worn over clothing)
- **Directionality:** Good (dual-mic array can point toward mouth)

### Battery Life
- **Capacity:** 550-600mAh achievable
- **Runtime:** 24-48hr realistic with aggressive power management

### Social Acceptance Score: 7/10
- **Visibility:** Medium (can hide under shirt, but cord visible on neck)
- **Stigma:** Low-medium ("wearing a wire" less of an issue than earbud form factor)
- **Fashion:** Neutral (pendant jewelry common, but "tech" look may stand out)

### Cost (BOM at 10K units): ~$60
- Standard enclosure, no exotic components

### Technical Feasibility: High (V1 Ready)
- Proven form factor, low R&D risk

### **V1 Decision:** ✅ **PRIMARY FORM FACTOR**

---

## Form Factor 2: Earring (Clip-On or Pierced)

### Description
Small device worn on earlobe, either clip-on (no piercing required) or stud-style (for pierced ears). Could be unilateral (single ear) or bilateral (both ears for stereo/beamforming).

### Specifications
- **Dimensions:** 15-20mm diameter, 5-8mm thickness (per earring)
- **Weight:** ≤8g per earring (comfort limit for extended wear)
- **Mounting:** Clip-on spring or post-and-back (for pierced ears)
- **Bilateral Design:** Two earrings with BLE communication between them

### Diagram (Text-Based)
```
       ┌───────┐
       │ Ear   │
       └───┬───┘
           │
    ┌──────▼──────┐
    │   ┌─────┐   │
    │   │ Mic │   │ (close to mouth ~10cm)
    │   └─────┘   │
    │   Earring   │ (clip-on or stud)
    │   ┌─────┐   │
    │   │ Bat │   │ (small battery, 100-150mAh)
    │   └─────┘   │
    └─────────────┘
```

### Pros
✓ **Optimal Audio:** Closest to mouth (10-15cm), best SNR
✓ **Discreet:** Small, blends with regular earrings
✓ **No Cord:** No tangling or neck discomfort
✓ **Aesthetic Flexibility:** Can be designed to look like premium jewelry

### Cons
✗ **Battery Severely Limited:** 100-150mAh per earring → 8-12hr battery life max
✗ **Weight Constraint:** >10g pulls on earlobe (painful)
✗ **Bilateral Complexity:** Two devices must stay synchronized (BLE mesh required)
✗ **Loss Risk:** Earrings easily lost or forgotten
✗ **Gendered Perception:** Earrings culturally gendered (though unisex designs exist)
✗ **No Haptics:** Insufficient space for LRA (would need to rely on phone for feedback)

### Audio Performance
- **Proximity:** Excellent (10-15cm from mouth)
- **Wind Noise:** High (directly exposed, ear turbulence)
- **Directionality:** Excellent if bilateral (stereo beamforming)

### Battery Life
- **Capacity:** 100-150mAh per earring (weight constraint)
- **Runtime:** 8-12hr realistic (need mid-day charging or hot-swap)

### Social Acceptance Score: 8/10
- **Visibility:** Low (blends with regular earrings if designed well)
- **Stigma:** Low (earrings socially normalized, even for men in many contexts)
- **Fashion:** High (can be premium jewelry aesthetic)

### Cost (BOM at 10K units): ~$80 (×2 earrings = $160)
- Bilateral design doubles component cost
- Miniaturization increases assembly difficulty

### Technical Feasibility: Medium-Low (V2+ Target)
- **Challenges:**
  - Miniaturizing MCU + battery + haptics into <20mm form factor
  - BLE synchronization between two earrings (latency-sensitive)
  - Charging solution (individual chargers for each earring?)

### **V1 Decision:** ❌ **DEFER TO V2+**
- Battery life too short for V1 promise (24hr minimum)
- Bilateral synchronization adds complexity
- Focus necklace for V1, prototype earring for V2

---

## Form Factor 3: Collar Clip (Lapel Pin Style)

### Description
Small device clips onto shirt collar, similar to lavalier microphone or Humane AI Pin. Positioned 5-10cm below mouth for optimal audio capture.

### Specifications
- **Dimensions:** 25-35mm x 15-20mm x 8-10mm (rectangular or circular)
- **Weight:** ≤15g
- **Mounting:** Spring clip (similar to tie clip) or magnetic mount

### Diagram (Text-Based)
```
  ┌─────────────────┐
  │   Shirt Collar   │
  └────────┬─────────┘
           │
      ┌────▼────┐
      │ ┌─────┐ │
      │ │ Mic │ │ (very close to mouth, 5-10cm)
      │ └─────┘ │
      │  Clip   │ (device body)
      │ ┌─────┐ │
      │ │ Btn │ │
      │ └─────┘ │
      └─────────┘
           │ (clips onto collar)
```

### Pros
✓ **Best Audio Quality:** 5-10cm from mouth, minimal fabric interference
✓ **No Cord:** No tangling or neck discomfort
✓ **Professional Look:** Similar to conference badge or lavalier mic
✓ **Easy On/Off:** Clip on when needed, remove easily

### Cons
✗ **Always Visible:** Cannot hide under clothing (defeats "discreet" goal)
✗ **Collared Shirts Only:** Doesn't work with t-shirts, hoodies (limits use cases)
✗ **"Wearing a Wire" Perception:** Highly visible clip-on device = surveillance concern
✗ **Drops Easily:** If clip loosens, device falls off
✗ **Limited Battery Space:** Thin form factor → 300-400mAh max → 18-20hr

### Audio Performance
- **Proximity:** Excellent (5-10cm, unobstructed)
- **Wind Noise:** Low (protected by collar)
- **Directionality:** Good (can orient mic toward mouth)

### Battery Life
- **Capacity:** 300-400mAh (thin form factor constraint)
- **Runtime:** 18-24hr (marginal for V1 requirement)

### Social Acceptance Score: 5/10
- **Visibility:** High (always exposed on collar)
- **Stigma:** Medium-high (looks like surveillance device or medical alert)
- **Fashion:** Low (tech device on collar not fashionable)

### Cost (BOM at 10K units): ~$55
- Slightly cheaper than necklace (smaller enclosure)

### Technical Feasibility: High (V1 Feasible)
- Similar complexity to necklace
- Clip mechanism well-understood (existing products)

### **V1 Decision:** ❌ **DEFER**
- Social acceptance too low (visible device = "wearing a wire")
- Limited to collared clothing (excludes casual/athletic wear)
- Consider for V3 "professional settings" variant (meetings, presentations)

---

## Form Factor 4: Wristband / Watch Integration

### Description
Smartwatch-style wearable with integrated microphones. Could be standalone device or integrate with existing smartwatches (Apple Watch, Galaxy Watch) via accessory band.

### Specifications
- **Dimensions:** 40-50mm diameter watch face, 10-15mm thickness
- **Weight:** 40-60g (watch + band)
- **Mounting:** Standard watch band (silicone, leather, metal)

### Diagram (Text-Based)
```
       ┌───────────┐
       │   Wrist   │
       └─────┬─────┘
             │
    ┌────────▼────────┐
    │  Watch Band     │
    └────────┬────────┘
             │
       ┌─────▼─────┐
       │ ┌───────┐ │
       │ │ Mics  │ │ (on wrist, 50-70cm from mouth)
       │ └───────┘ │
       │   Watch   │ (standard form factor)
       │  ┌─────┐  │
       │  │ Btn │  │
       │  └─────┘  │
       └───────────┘
```

### Pros
✓ **Mainstream Form Factor:** Smartwatches widely accepted, zero stigma
✓ **Large Battery Space:** 400-500mAh achievable (multi-day battery life)
✓ **Display Possible:** Could add visual feedback (not just haptics)
✓ **Accelerometer Built-In:** Activity tracking, context awareness
✓ **Integration Opportunity:** Partner with Apple/Samsung for accessory band

### Cons
✗ **Poor Audio Quality:** 50-70cm from mouth (far-field), wrist movement noise
✗ **Wind Noise:** Wrist exposed, more wind turbulence than necklace
✗ **Occlusion During Gestures:** Hand movements block microphone
✗ **Haptics Less Perceptible:** Wrist less sensitive than chest (vibration intensity must be higher)
✗ **Watch Fatigue:** Some users don't wear watches (uncomfortable, skin irritation)

### Audio Performance
- **Proximity:** Poor (50-70cm, far-field capture)
- **Wind Noise:** High (wrist very exposed)
- **Movement Noise:** High (accelerometer can detect, but difficult to filter)

### Battery Life
- **Capacity:** 400-500mAh achievable
- **Runtime:** 24-48hr realistic (standard smartwatch range)

### Social Acceptance Score: 9/10
- **Visibility:** High, but normalized (smartwatches ubiquitous)
- **Stigma:** None (watches are mainstream)
- **Fashion:** High (many premium watch designs available)

### Cost (BOM at 10K units): ~$70
- Similar to necklace, but display adds cost if included

### Technical Feasibility: Medium (V2+ Target)
- Audio quality is the killer issue: too far from mouth
- Would require aggressive noise cancellation (beamforming, adaptive filtering)
- Could work for "meeting mode" (user sits still, 1m from device), not casual conversation

### **V1 Decision:** ❌ **DEFER TO V3+**
- Audio quality insufficient for conversational coaching
- Better suited for specific use cases (presentations, meetings) where user is stationary
- Consider partnership with Apple/Samsung for V3 accessory band (leverage their ecosystem)

---

## Form Factor 5: Shirt Button Replacement (Hidden Mic)

### Description
Device replaces one shirt button (usually 2nd or 3rd from collar). Blends perfectly with clothing, nearly invisible. Microphones in button, electronics in small pod behind shirt.

### Specifications
- **Dimensions:** 15mm diameter button (front), 30mm x 20mm x 8mm pod (rear)
- **Weight:** ≤12g total
- **Mounting:** Snap-on like regular button, thin wire connects front and rear

### Diagram (Text-Based)
```
  ┌──────────────────┐
  │   Shirt Front    │
  │        ●         │ ← Button (visible part with mic)
  │      ┌─┼─┐       │
  │      │ │ │       │ (thin wire inside shirt)
  │      └─┼─┘       │
  └────────┼─────────┘
           │
  ┌────────▼─────────┐
  │   Shirt Back     │
  │   ┌─────────┐    │
  │   │  Pod    │    │ (battery, MCU, BLE - hidden)
  │   │ (30x20) │    │
  │   └─────────┘    │
  └──────────────────┘
```

### Pros
✓ **Completely Hidden:** No visible tech (button looks like regular button)
✓ **Excellent Audio:** 10-15cm from mouth, no fabric muffling (button on outside)
✓ **Zero Stigma:** Nobody knows it's a device
✓ **Multiple Button Option:** Could have 2-3 buttons (redundancy, beamforming)

### Cons
✗ **Clothing Dependency:** Only works with buttoned shirts (excludes t-shirts, hoodies, dresses)
✗ **Daily Attachment:** Must move device to new shirt each day (friction)
✗ **Washing Challenge:** Must remove before washing (easy to forget)
✗ **Battery Severely Limited:** 100-150mAh in rear pod → 8-12hr max
✗ **Wiring Fragility:** Thin wire between button and pod prone to breakage
✗ **No Haptics:** Rear pod on back = haptics not perceptible on chest

### Audio Performance
- **Proximity:** Excellent (10-15cm, unobstructed)
- **Wind Noise:** Low (protected by shirt)
- **Directionality:** Good (button faces outward toward conversation partner)

### Battery Life
- **Capacity:** 100-150mAh (size constraint)
- **Runtime:** 8-12hr (requires frequent charging)

### Social Acceptance Score: 10/10
- **Visibility:** None (perfectly hidden)
- **Stigma:** None (no one knows it's a device)
- **Fashion:** Neutral (looks like regular button)

### Cost (BOM at 10K units): ~$50
- Simpler than necklace (no enclosure), but wiring and button finish add cost

### Technical Feasibility: Low (V3+ Moonshot)
- **Challenges:**
  - Miniaturizing battery + MCU + BLE into 30x20x8mm pod
  - Reliable thin wire connection (must survive movement, washing accidentally)
  - No haptics (rear pod not perceptible)
  - User friction (daily attachment to new shirt)

### **V1 Decision:** ❌ **DEFER TO V3+ (R&D Project)**
- Battery life too short
- High user friction (daily attachment)
- Cool concept for invisibility, but practical challenges significant
- Consider as "stealth mode" variant for high-stigma users

---

## Form Factor 6: Eyeglasses / Sunglasses

### Description
Audio integrated into eyeglass temples (similar to Bose Frames, Ray-Ban Meta). Microphones near temples, bone conduction speakers optional for audio feedback.

### Specifications
- **Form:** Standard eyeglass frames + integrated electronics
- **Weight:** 30-50g (standard glasses: 20-30g)
- **Battery:** 200-300mAh per temple (total 400-600mAh)

### Diagram (Text-Based)
```
       ┌───────────────────────┐
       │  Eyeglass Frame (top)  │
       └───┬───────────────┬───┘
           │               │
      ┌────▼───┐       ┌───▼────┐
      │ Temple │       │ Temple │ (left & right)
      │ ┌────┐ │       │ ┌────┐ │
      │ │Mic │ │       │ │Mic │ │ (near ears, ~15cm from mouth)
      │ │Bat │ │       │ │Bat │ │
      │ │BLE │ │       │ │BLE │ │
      │ └────┘ │       │ └────┘ │
      └────────┘       └────────┘
```

### Pros
✓ **Mainstream Form Factor:** Glasses very socially accepted (millions wear daily)
✓ **Bilateral Audio:** Stereo microphones enable excellent beamforming
✓ **Precedent Products:** Ray-Ban Meta, Bose Frames prove market acceptance
✓ **Bone Conduction Option:** Could provide audio feedback (not just haptics)
✓ **Vision Correction Integration:** Could include prescription lenses

### Cons
✗ **Not Universal:** Only 60% of US adults wear glasses; excludes 40% of market
✗ **Audio Distance:** 15-20cm from mouth (worse than necklace, better than watch)
✗ **Battery in Temples:** Thin form factor limits battery (300mAh/temple max)
✗ **Prescription Lens Complexity:** If offering prescription, need optical partnership
✗ **High Cost:** Custom frames + lenses + electronics = $150+ BOM

### Audio Performance
- **Proximity:** Good (15-20cm from mouth)
- **Wind Noise:** Moderate (temples semi-protected by hair/head)
- **Directionality:** Excellent (bilateral stereo, beamforming toward mouth)

### Battery Life
- **Capacity:** 400-600mAh (200-300mAh per temple)
- **Runtime:** 16-24hr (constrained by temple thickness)

### Social Acceptance Score: 9/10
- **Visibility:** High, but normalized (glasses ubiquitous)
- **Stigma:** None ("smart glasses" category growing)
- **Fashion:** High (many premium frame styles)

### Cost (BOM at 10K units): ~$100 (frames + electronics, excluding prescription lenses)

### Technical Feasibility: Medium (V2+ Partnership)
- **Challenges:**
  - Custom frame design (mold costs high)
  - Optical partnership needed if prescription lenses
  - Bilateral synchronization (similar to earrings)
- **Opportunity:** Partner with existing smart glasses companies (Meta, Amazon, etc.)

### **V1 Decision:** ❌ **DEFER TO V2+ (Partnership Track)**
- Requires optical partnership (Warby Parker, Zenni, Luxottica)
- Excludes non-glasses wearers (40% of population)
- Consider V2 partnership after necklace proves concept
- Could be "premium" tier (prescription Tizzy glasses)

---

## Form Factor Comparison Matrix

| Form Factor | Audio Quality | Battery Life | Social Acceptance | Comfort | Cost | Feasibility | **TOTAL SCORE** |
|-------------|---------------|--------------|-------------------|---------|------|-------------|-----------------|
| **Necklace** | 8/10 | 9/10 | 7/10 | 8/10 | 9/10 | 10/10 | **8.3/10** ✅ |
| Earring | 9/10 | 4/10 | 8/10 | 7/10 | 5/10 | 5/10 | 6.3/10 |
| Collar Clip | 9/10 | 7/10 | 5/10 | 7/10 | 9/10 | 9/10 | 7.3/10 |
| Watch | 4/10 | 8/10 | 9/10 | 6/10 | 8/10 | 7/10 | 6.7/10 |
| Button | 9/10 | 4/10 | 10/10 | 5/10 | 7/10 | 3/10 | 6.0/10 |
| Glasses | 7/10 | 7/10 | 9/10 | 7/10 | 6/10 | 6/10 | 7.0/10 |

**Winner: Necklace (8.3/10)** - Best balance of audio quality, battery life, cost, and feasibility for V1.

---

## V1-V3 Form Factor Roadmap

### V1 (Months 0-6): Necklace MVP
- **Single form factor:** Necklace pendant (30-40mm, 24hr battery)
- **Goal:** Prove core value proposition with manageable hardware complexity
- **Market:** College-age autistic adults, therapy partnerships

### V1.5 (Months 6-12): Necklace Refinement
- **Iteration:** Improved battery (48hr), better under-clothing audio, aesthetic options (colors, finishes)
- **Goal:** Production-ready for broader launch (1,000-10,000 users)

### V2 (Months 12-24): Alternative Form Factors
- **Add:** Earring prototype (bilateral, 12hr battery)
- **Add:** Glasses partnership exploration (Meta, Amazon)
- **Goal:** Expand addressable market to users who won't wear necklaces

### V3 (Months 24+): Specialized Use Cases
- **Add:** Collar clip for professional settings (meetings, presentations)
- **Add:** Button replacement for ultra-discreet use cases
- **Add:** Watch integration (Apple Watch accessory band)
- **Goal:** Serve diverse use cases and user preferences

---

## Design Principles for All Form Factors

### 1. Discreet ≠ Covert
- All form factors include **visible indicator** (LED, vibration acknowledgment)
- Legitimacy requires some signal to bystanders
- Design principle: "Discreet enough to not draw attention, visible enough to be legitimate"

### 2. User Control Always Present
- Every form factor includes **physical hard mute** (button or switch)
- User must be able to disable recording immediately

### 3. Comfort First
- Maximum weight limits strictly enforced (necklace 25g, earring 8g, etc.)
- Prolonged wear testing with 20+ users before production

### 4. Audio Quality Non-Negotiable
- If audio quality insufficient for coaching, form factor rejected
- Example: Watch deferred because 50cm distance too far for reliable prosody detection

### 5. Battery Life Minimum: 16 Hours
- Users need full waking day coverage (6am-10pm)
- Forms that don't meet this (earring, button) deferred or positioned as "short-session" variants

---

## User Persona to Form Factor Mapping

| User Persona | Primary Form Factor | Secondary Option | Rationale |
|--------------|---------------------|------------------|-----------|
| **College Student (18-25)** | Necklace | Earring | Casual style, all-day use, budget-conscious |
| **Professional (25-40)** | Collar Clip | Glasses | Collared shirts common, meetings-focused |
| **Parent Buying for Child (8-17)** | Necklace | - | Safety (breakaway cord), durability priority |
| **Glasses Wearer** | Glasses Integration | Necklace | Already wear glasses daily, prefer not adding device |
| **High-Stigma Sensitivity** | Button Replacement | Earring | Wants maximum invisibility |

---

## Conclusion

The **necklace pendant** is the optimal V1 form factor, scoring highest overall on the criteria matrix. It balances audio quality, battery life, cost, and social acceptance while being technically feasible for immediate development. Alternative form factors (earrings, glasses, collar clip) are valuable for future expansion but carry risks (battery constraints, audio quality, complexity) that would delay V1 launch.

**Strategic Approach:**
1. **V1:** Nail the necklace (prove value proposition)
2. **V2:** Add earring and glasses options (expand market)
3. **V3:** Specialized form factors for niche use cases (professional, ultra-discreet)

This phased approach minimizes V1 risk while keeping options open for long-term product line diversification.

---

## Next Steps

1. **Necklace Industrial Design (Months 0-2):**
   - Partner with industrial design firm (IDEO, Frog, or similar)
   - Goal: Premium aesthetic that doesn't scream "medical device"
   - Explore finish options: matte black, brushed metal, wood veneer, custom colors

2. **Earring Prototype (Months 6-9):**
   - R&D project in parallel with V1 launch
   - Focus on battery miniaturization and bilateral sync
   - User testing with 10-20 users for comfort and aesthetic

3. **Glasses Partnership Exploration (Months 9-12):**
   - Reach out to Meta (Ray-Ban partnership team)
   - Explore Warby Parker integration (prescription lenses + Tizzy electronics)
   - Business development discussions

4. **User Preference Survey (Month 3):**
   - Survey beta users: "If Tizzy came in multiple forms, which would you choose?"
   - Validate demand for alternative form factors before investing in R&D
