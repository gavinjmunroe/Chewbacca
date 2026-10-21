# Hardware Requirements Specification

**Document Version:** 1.0
**Last Updated:** February 13, 2026
**Status:** V1 Engineering Requirements

---

## Overview

This document specifies the complete hardware requirements for Tizzy's wearable conversation coach device. Requirements are organized by subsystem and include target specifications, test criteria, and rationale.

---

## System-Level Requirements

### SR-1: Form Factor
- **Requirement:** Necklace pendant, wearable under or over clothing
- **Dimensions:** 30-40mm diameter, 8-12mm thickness
- **Weight:** ≤25g
- **Rationale:** Must be comfortable for all-day wear; weight >25g causes neck strain

### SR-2: Battery Life
- **Requirement:** Minimum 24 hours continuous operation
- **Target:** 48 hours continuous operation
- **Standby:** 7 days with periodic sync (4x daily)
- **Test:** Continuous audio capture with haptic events (20/day) + BLE sync (4x daily, 15 min each)
- **Rationale:** User should not need to charge daily; 24hr minimum covers waking hours + overnight buffer

### SR-3: Environmental Resistance
- **Requirement:** IP54 (splash and sweat resistant)
- **Test:** IEC 60529 IP54 testing (dust ingress limited, water splashing from any direction)
- **Rationale:** Device worn during exercise, cooking, outdoor activities; must survive sweat and rain

### SR-4: Drop Resistance
- **Requirement:** Survive 1.5m drop onto concrete
- **Test:** 20 drops from 1.5m height onto hard surface, device remains functional
- **Rationale:** Users will drop device; necklace may break away during play/sports

### SR-5: Operating Temperature
- **Requirement:** -10°C to 50°C
- **Test:** Functionality verified at temperature extremes
- **Rationale:** Device worn indoors and outdoors in varying climates

### SR-6: Skin Contact Safety
- **Requirement:** Materials hypoallergenic (medical-grade silicone or titanium)
- **Test:** ISO 10993 biocompatibility testing (skin sensitivity, irritation)
- **Rationale:** Device in direct skin contact for extended periods

---

## Audio Subsystem Requirements

### AU-1: Microphone Configuration
- **Requirement:** Dual MEMS microphone array
- **Spacing:** 15-20mm between microphones (beamforming)
- **Rationale:** Directional audio toward wearer's mouth; far-field noise reduction

### AU-2: Microphone Specifications
- **Type:** MEMS omnidirectional
- **Frequency Response:** 100Hz - 8kHz (conversational speech range)
- **SNR:** ≥64dB
- **Sensitivity:** -38dBV/Pa ±2dB
- **Acoustic Overload Point:** ≥120dB SPL
- **Test:** Anechoic chamber frequency sweep; verify response within ±3dB across range
- **Rationale:** Human speech fundamental frequency 80-300Hz; 8kHz captures formants; 64dB SNR adequate for speech in moderate noise

### AU-3: Audio Capture Quality
- **Requirement:** Intelligible speech capture at 1m distance in 65dB ambient noise
- **Test:** Record speech (TIMIT dataset samples) at 1m in cafeteria-level noise; WER <10% on transcription
- **Rationale:** Typical conversation distance; cafeteria is target use case

### AU-4: Under-Clothing Performance
- **Requirement:** Speech intelligibility maintained when device under clothing (1-2 layers)
- **Test:** Repeat AU-3 with device under cotton t-shirt and hoodie; WER <15%
- **Rationale:** Many users will wear under clothing to reduce visibility

### AU-5: Wind Noise Rejection
- **Requirement:** Speech intelligible with 15 mph wind
- **Test:** Wind tunnel at 15 mph, record speech; verify spectral subtraction reduces wind noise by >15dB
- **Rationale:** Outdoor conversations; 15 mph is moderate breeze

### AU-6: Hard Mute
- **Requirement:** Physical microphone power cutoff (not software-only)
- **Test:** Measure microphone power consumption in mute mode (must be 0mA)
- **Rationale:** User trust requires hardware-enforced mute

---

## Processing Subsystem Requirements

### PR-1: Microcontroller Unit (MCU)
- **Requirement:** ARM Cortex-M7 or equivalent, ≥100MHz, ≥512KB RAM, ≥2MB Flash
- **Target:** Nordic nRF52840 or STM32H7 series
- **Rationale:** Sufficient compute for VAD, feature extraction, lightweight ML; low power

### PR-2: Audio DSP
- **Requirement:** Hardware DSP acceleration or MCU with DSP extensions (ARM CMSIS-DSP)
- **Performance:** 16kHz audio processing with <50ms latency
- **Test:** VAD + feature extraction pipeline runs at 16kHz real-time with <20% CPU utilization
- **Rationale:** Leave headroom for ML inference and BLE communication

### PR-3: Machine Learning Accelerator (Optional V1, Required V2)
- **Requirement:** Hardware ML accelerator (TensorFlow Lite Micro optimized)
- **Performance:** Inference <10ms per turn for on-device models
- **Rationale:** Real-time haptics require fast inference; software-only may not meet latency target

### PR-4: Storage
- **Requirement:** 4-8GB eMMC or NAND flash
- **Performance:** Write speed ≥10MB/s (audio capture), read speed ≥20MB/s (BLE transfer)
- **Test:** Sustained write of 16kHz audio (256kbps) for 30 minutes without buffer overflow
- **Rationale:** Store circular buffer, features, user markers, firmware

### PR-5: Circular Buffer
- **Requirement:** 30-120 minute audio buffer in RAM or flash (user configurable)
- **Implementation:** Ring buffer with FIFO overwrite policy
- **Test:** Verify buffer overwrites oldest data when full; no memory leaks after 48hr continuous operation
- **Rationale:** Privacy-first: audio not persisted unless user marks

---

## Haptic Subsystem Requirements

### HA-1: Actuator Type
- **Requirement:** Linear Resonant Actuator (LRA) preferred over ERM
- **Rationale:** LRA has faster response (<10ms), more precise patterns, lower power

### HA-2: Vibration Patterns
- **Requirement:** Support 3 distinct patterns in V1:
  1. Single pulse: 200ms, 1.2G
  2. Double pulse: 150ms-100ms gap-150ms, 1.2G
  3. Long pulse: 500ms, 1.8G
- **Test:** User study (N=20) confirms >90% can distinguish patterns
- **Rationale:** Cognitive load constraint: 3 patterns max for V1; more in V2 after training

### HA-3: Latency
- **Requirement:** <50ms from software trigger to perceptible vibration
- **Test:** Oscilloscope measures trigger signal to actuator acceleration
- **Rationale:** Real-time feedback must feel immediate

### HA-4: Perceptibility Through Clothing
- **Requirement:** Vibration perceptible through 2 layers of fabric
- **Test:** User wearing cotton t-shirt + hoodie; can feel 1.2G vibration with >95% reliability
- **Rationale:** Device worn under clothing; haptics must penetrate fabric

### HA-5: Audible Noise
- **Requirement:** <30dB at 30cm distance
- **Test:** Sound level meter at 30cm; verify haptic activation not audible in 40dB ambient noise
- **Rationale:** Haptics should be discreet; not draw attention from bystanders

---

## Power Subsystem Requirements

### PW-1: Battery Capacity
- **Requirement:** 500-600mAh lithium-polymer pouch cell
- **Safety:** UN38.3 certified (transport safety), UL1642 or IEC62133 (cell safety)
- **Test:** Charge/discharge cycles (500 cycles to 80% capacity)
- **Rationale:** Balances size/weight with 24-48hr battery life

### PW-2: Charging
- **Requirement:** USB-C charging port (5V, 1A) OR magnetic pogo-pin (waterproofing)
- **Charge Time:** <2hr to 80%, <3hr to 100%
- **Test:** Measure charge time from 0% to full; verify charge termination at 100%
- **Rationale:** USB-C is industry standard; magnetic alternative for sealed design

### PW-3: Battery Management System (BMS)
- **Requirement:** Overcurrent, overvoltage, overtemperature protection
- **Test:** Simulate fault conditions (short circuit, overcharge); verify BMS cuts power
- **Rationale:** Safety-critical; prevent fire/explosion risk

### PW-4: Power Budget
| Component | Active Power | Duty Cycle | Average Power |
|-----------|--------------|------------|---------------|
| Dual MEMS Mics | 200µA | 100% | 200µA |
| VAD Processing | 2mA | 100% | 2mA |
| Audio DSP | 15mA | 50% | 7.5mA |
| MCU (full) | 25mA | 30% | 7.5mA |
| BLE | 10mA | 10% | 1mA |
| Haptic | 100mA | <1% | 0.5mA |
| **Total** | | | **18.7mA** |

**Test:** Measure actual power consumption over 24hr period; verify <20mA average
**Rationale:** 550mAh / 20mA = 27.5hr battery life (margin for inefficiencies)

### PW-5: Low Battery Warning
- **Requirement:** User notified (app + LED blink) at 20% battery
- **Test:** Discharge to 20%; verify notification delivered within 1 minute
- **Rationale:** Prevent unexpected shutdown during important conversation

### PW-6: Battery Life Estimation Accuracy
- **Requirement:** Remaining battery life estimate within ±15%
- **Test:** Compare estimated vs. actual runtime; error <15%
- **Rationale:** User needs reliable estimate to plan charging

---

## Connectivity Subsystem Requirements

### CN-1: Bluetooth Low Energy
- **Requirement:** BLE 5.0 or later
- **Range:** 10m minimum (line of sight)
- **Data Rate:** 1Mbps (effective throughput >500kbps for file transfer)
- **Test:** Transfer 1MB file at 10m distance; verify <20 seconds
- **Rationale:** BLE 5.0 has 2x speed vs. BLE 4.2; essential for fast sync

### CN-2: BLE Security
- **Requirement:** LE Secure Connections (ECDH key exchange, AES-128-CCM)
- **Test:** Attempt MITM attack with Ubertooth; verify pairing fails
- **Rationale:** Protect data in transit; prevent eavesdropping

### CN-3: Connection Stability
- **Requirement:** Maintain BLE connection for 15 minutes at 5m distance with interference
- **Test:** Place device 5m from phone, introduce 2.4GHz interference (Wi-Fi, microwave); verify <5% packet loss
- **Rationale:** Sync should complete even in noisy RF environment

### CN-4: Offline Operation
- **Requirement:** Device functions normally without phone connection for 48 hours
- **Test:** Disconnect phone; verify audio capture, feature extraction, haptics continue; data syncs when reconnected
- **Rationale:** User may forget phone or device out of range

---

## User Interface Requirements

### UI-1: Physical Button
- **Requirement:** Single multi-function button accessible through clothing
- **Actions:**
  - Single press: Mark moment
  - Double press: Toggle mute
  - Long press (3s): Power off
  - Triple press (V1.5): Panic delete
- **Test:** 100 actuations through 2 layers of fabric; 95% success rate
- **Rationale:** Single button reduces complexity; multi-function saves space

### UI-2: LED Indicator
- **Requirement:** RGB LED visible on device edge
- **States:**
  - Green slow pulse: Capture enabled, idle
  - Green solid: Active conversation capture
  - Red solid: Muted
  - Amber: Low battery
  - Off: Powered down
- **Test:** Verify colors distinguishable in bright sunlight and darkness
- **Rationale:** Visual feedback for recording status (privacy/consent)

### UI-3: Button Feedback
- **Requirement:** Tactile click and brief haptic confirmation on button press
- **Latency:** <50ms from press to feedback
- **Test:** User study (N=20) confirms button press always perceptible
- **Rationale:** User needs confirmation of press, especially through clothing

---

## Mechanical Requirements

### ME-1: Enclosure Material
- **Requirement:** Medical-grade silicone (Shore A 40-60) or anodized aluminum
- **Test:** ISO 10993 biocompatibility, ASTM D2240 hardness
- **Rationale:** Soft enough for comfort, hard enough to protect electronics

### ME-2: Cord
- **Requirement:** Adjustable length 40-60cm, breakaway force 10-20N (safety for children)
- **Material:** Silicone or woven nylon
- **Test:** Tensile test to breakaway force; verify clean separation (no sharp edges)
- **Rationale:** Prevent strangulation hazard

### ME-3: Assembly
- **Requirement:** Ultrasonic welding or snap-fit (no visible screws)
- **Test:** IP54 water ingress testing after assembly; no leaks
- **Rationale:** Aesthetic (no screws) and waterproofing

### ME-4: Repairability
- **Requirement:** Battery replaceable by service center (not user)
- **Design:** Non-destructive disassembly possible with specialized tools
- **Rationale:** Extend product lifespan; battery degrades after 500 cycles (18-24 months)

---

## Sensor Requirements (Optional/Future)

### SE-1: Accelerometer (V1.5+)
- **Requirement:** 3-axis, ±8g range, <1mW power
- **Use Cases:** Orientation detection (worn correctly?), activity classification (sitting/walking/running)
- **Test:** Verify orientation accuracy >95%; activity classification accuracy >85%
- **Rationale:** Context-aware coaching (e.g., suppress haptics during high activity)

### SE-2: Ambient Light Sensor (V2+)
- **Requirement:** 0.01 - 10,000 lux range, <0.5mW power
- **Use Case:** Infer environment (indoors/outdoors/dark)
- **Rationale:** Correlate lighting with conversation patterns

---

## Safety and Compliance Requirements

### SF-1: Electrical Safety
- **Requirement:** UL or ETL certification for battery and charging
- **Test:** Short circuit, overcharge, overdischarge, thermal abuse tests
- **Rationale:** Lithium battery fire risk; certification mandatory for consumer electronics

### SF-2: FCC Certification
- **Requirement:** FCC Part 15 (radio frequency devices)
- **Test:** EMI/EMC testing (emissions <FCC limits, immunity to external interference)
- **Rationale:** Legal requirement for BLE transmission in USA

### SF-3: Choking Hazard (Children)
- **Requirement:** Device >31.7mm in all dimensions (CPSC small parts regulation)
- **Test:** Small parts cylinder test (device does not fit in 31.7mm x 57.1mm cylinder)
- **Rationale:** If used by children under 3, must not be choking hazard (though V1 targets 18+)

### SF-4: Electromagnetic Interference
- **Requirement:** Device does not interfere with medical devices (pacemakers, hearing aids)
- **Test:** Proximity testing with common medical devices; verify no malfunction
- **Rationale:** Users may have hearing aids or other medical devices

---

## Manufacturing Requirements

### MF-1: Cost Target
- **Requirement:** Bill of Materials (BOM) <$60 at 10,000 unit volume
- **Breakdown:**
  - MCU + BLE: $8
  - Dual mics: $2
  - LRA haptic: $3
  - Battery: $5
  - PCB: $4
  - Enclosure: $10
  - Assembly: $15
  - Testing: $5
  - Misc (passives, connectors): $8
- **Total:** ~$60
- **Rationale:** Target retail $150-250 (subsidized for autism users); need margin for R&D, support

### MF-2: Quality Assurance
- **Requirement:** <2% DOA (dead on arrival) rate, <5% return rate in first year
- **Test:** 100% functional test before shipping (audio capture, haptics, BLE, charging)
- **Rationale:** Quality issues destroy early-stage trust

### MF-3: Production Volume
- **V1 Pilot:** 500-2,000 units
- **V1.5 Launch:** 10,000-50,000 units
- **Contract Manufacturer:** USA or Taiwan (quality control, IP protection)

---

## Testing and Validation Plan

### Hardware Validation Testing (Pre-Launch)

**Audio System:**
- [ ] Frequency response sweep (100Hz-8kHz)
- [ ] SNR measurement (>64dB)
- [ ] Under-clothing intelligibility test
- [ ] Wind noise rejection (15 mph wind tunnel)

**Haptic System:**
- [ ] Pattern distinguishability user study (N=20)
- [ ] Perceptibility through clothing test
- [ ] Audible noise measurement (<30dB at 30cm)

**Power System:**
- [ ] Battery life test (24hr minimum under realistic load)
- [ ] Charge cycle test (500 cycles to 80% capacity)
- [ ] Overcharge/short circuit safety test

**Durability:**
- [ ] Drop test (20 drops from 1.5m)
- [ ] IP54 water ingress test (30 minutes)
- [ ] Cord breakaway force test (10-20N)

**Connectivity:**
- [ ] BLE range test (10m minimum)
- [ ] BLE transfer speed test (1MB in <20 sec)
- [ ] Connection stability with interference

**Compliance:**
- [ ] FCC Part 15 certification
- [ ] UL/ETL battery safety certification
- [ ] ISO 10993 biocompatibility testing

---

## Design Trade-Offs

| Trade-Off | Decision | Rationale |
|-----------|----------|-----------|
| **Battery Life vs. Size** | 24hr minimum, accept 10mm thickness | All-day use non-negotiable; users prefer thicker device over daily charging |
| **Microphone Placement** | Under-clothing optimized | Social acceptance > perfect audio; DSP compensates for muffling |
| **LRA vs. ERM Haptic** | LRA (higher cost) | Faster response, better patterns, lower power critical for UX |
| **USB-C vs. Magnetic Charging** | USB-C for V1 | Standard, familiar; magnetic for V2 if waterproofing requires sealed design |
| **Accelerometer in V1** | No (V1.5+) | Focus on core audio/haptic functionality first; add sensors iteratively |
| **Replaceable Battery** | No (service center only) | Maintain waterproofing; battery life 18-24 months sufficient |

---

## Open Hardware Questions

1. **Optimal Microphone Placement:**
   - Front-facing vs. omnidirectional positioning?
   - Single vs. dual mic trade-off (cost vs. directionality)?
   - Requires acoustic modeling and prototyping

2. **Haptic Intensity Calibration:**
   - Can we auto-calibrate haptic intensity based on user's perception threshold?
   - Requires sensor feedback (capacitive touch to detect skin contact) or user input during onboarding

3. **Thermal Management:**
   - Device temperature during extended audio processing + BLE + haptics?
   - May need heat sink or thermal paste if MCU runs hot

4. **Cord Attachment Point:**
   - Top vs. side vs. bottom of pendant?
   - Affects comfort and audio capture quality (cord vibration noise)

5. **Aesthetic Design:**
   - How to make device look premium, not "assistive tech"?
   - Requires industrial design partnership

---

## Next Steps

1. **Prototype Development (Months 0-3):**
   - Build dev kit prototype (Nordic nRF52840 DK + MEMS mic breakout + LRA)
   - Validate audio capture quality (lab + field tests)
   - Test haptic patterns with 10-20 users

2. **Engineering Validation Testing (EVT, Months 3-4):**
   - Build 20 units with custom PCB (not dev kit)
   - Full hardware validation tests (see checklist above)
   - Iterate on design based on test results

3. **Design Validation Testing (DVT, Months 4-5):**
   - Build 100 units with final design (near-production)
   - Beta user testing (20-50 users)
   - Collect feedback on comfort, battery life, usability

4. **Production Validation Testing (PVT, Months 5-6):**
   - Build 500 units with production tooling
   - Compliance testing (FCC, UL, biocompatibility)
   - Final design freeze

5. **Mass Production (Months 6+):**
   - 2,000 units for V1 launch
   - Scale to 10,000+ for V1.5

---

## Conclusion

This hardware requirements specification defines an aggressive but achievable V1 device that balances always-wearable form factor, robust audio capture, real-time haptic feedback, and all-day battery life. The core risk areas are:

1. **Audio quality under clothing** (requires extensive prototyping and DSP tuning)
2. **Battery life under real-world usage** (power budget is tight)
3. **Haptic perceptibility and distinguishability** (user study critical)

All requirements are testable and traceable to user needs and market research. The design prioritizes core functionality (audio + haptics) over nice-to-haves (accelerometer, etc.) to ensure V1 delivers on the essential value proposition: real-time conversational coaching for autism.
