# Prototypes

This directory contains prototypes for the Tizzy project, including hardware, firmware, and software prototypes.

## Purpose

Prototypes help us:
- Test concepts and ideas before full development
- Validate technical approaches and feasibility
- Gather user feedback on functionality
- Identify issues early in development
- Iterate rapidly on design and features
- Demonstrate progress to stakeholders and potential funders

## Types of Prototypes

### Hardware Prototypes

Physical device prototypes at various stages of development:

- **Breadboard Prototypes:** Initial circuit testing and validation
- **PCB Prototypes:** Early printed circuit board designs
- **Enclosure Prototypes:** 3D printed or mockup cases
- **Integrated Prototypes:** Combined electronics and enclosure

### Firmware Prototypes

Embedded software for testing hardware functionality:

- **Sensor Testing:** Code to test individual sensors
- **Data Collection:** Prototype firmware for gathering data
- **Power Management:** Testing battery life and power optimization
- **Communication:** Bluetooth/WiFi connectivity tests

### Software Prototypes

Application prototypes for user interaction:

- **Mobile App Prototypes:** Interactive mockups or functional apps
- **Web Dashboard Prototypes:** Browser-based interfaces
- **API Prototypes:** Backend service demonstrations
- **Data Visualization:** Prototype analytics and reporting

### Interactive Prototypes

Clickable prototypes for user testing:

- **Figma Prototypes:** Interactive design mockups
- **HTML/CSS Prototypes:** Coded interface demonstrations
- **Video Prototypes:** Demonstration videos of functionality

## Organization

Prototypes should be organized by type and version:

```
prototypes/
├── hardware/
│   ├── v1-breadboard/
│   ├── v2-pcb/
│   └── v3-integrated/
├── firmware/
│   ├── sensor-tests/
│   ├── data-collection/
│   └── power-management/
├── software/
│   ├── mobile-app/
│   ├── web-dashboard/
│   └── api/
├── interactive/
│   ├── figma-prototypes/
│   └── html-prototypes/
└── documentation/
    ├── test-results/
    ├── user-feedback/
    └── iteration-notes/
```

## Naming Conventions

Use clear, descriptive names with version numbers:

```
[type]-[component]-v[version]-[date].ext

Examples:
hardware-sensor-board-v1-2026-03-15/
firmware-data-logger-v2-2026-04-01.ino
software-mobile-dashboard-v1-2026-05-10/
interactive-onboarding-flow-v3-2026-06-20.fig
```

## Hardware Prototype Guidelines

### Safety First
- Follow electrical safety standards
- Use appropriate voltage and current protection
- Document any safety considerations
- Test in safe environments
- Never test unverified circuits on humans

### Documentation Requirements

Each hardware prototype should include:

- **Bill of Materials (BOM):** Complete parts list with sources
- **Schematics:** Circuit diagrams (KiCad, Eagle, or PDF)
- **PCB Layout:** Board design files (if applicable)
- **Assembly Instructions:** How to build the prototype
- **Test Procedures:** How to verify functionality
- **Test Results:** What worked, what didn't, lessons learned
- **Photos/Videos:** Visual documentation of the build

### Testing Checklist

- [ ] All components verified functional individually
- [ ] Voltage levels measured and confirmed safe
- [ ] Power consumption measured
- [ ] Communication protocols tested
- [ ] Sensor accuracy validated
- [ ] Environmental conditions tested (temperature, humidity, movement)
- [ ] Battery life estimated
- [ ] Safety review completed

## Firmware Prototype Guidelines

### Code Organization

```
firmware-prototype/
├── README.md (description, setup, usage)
├── src/ (source code)
├── lib/ (libraries)
├── test/ (test code)
├── docs/ (documentation)
└── results/ (test output, logs)
```

### Documentation Requirements

- **Purpose:** What does this firmware prototype test?
- **Hardware Requirements:** What hardware is needed?
- **Setup Instructions:** How to flash and configure
- **Expected Behavior:** What should happen?
- **Test Results:** What actually happened?
- **Known Issues:** Any bugs or limitations?
- **Next Steps:** What to improve or test next?

### Best Practices

- Comment your code thoroughly
- Include debug output for testing
- Use version control for all code
- Test incrementally (one feature at a time)
- Log data for analysis
- Keep prototypes modular for reuse

## Software Prototype Guidelines

### Types of Software Prototypes

1. **Throwaway Prototypes:** Quick and dirty, meant to be discarded
2. **Evolutionary Prototypes:** Iterative improvements toward final product
3. **Proof of Concept:** Demonstrates feasibility of an approach
4. **Visual Prototypes:** UI/UX focused, may lack backend functionality

### Documentation Requirements

- **Purpose:** What does this prototype demonstrate?
- **Technology Stack:** What tools/frameworks are used?
- **Setup Instructions:** How to run the prototype
- **Features Implemented:** What works?
- **Known Limitations:** What doesn't work?
- **User Feedback:** Results from testing (if applicable)
- **Next Steps:** Path to production implementation

### Code Quality

Prototype code doesn't need to be production-ready, but should be:
- Readable with clear comments
- Organized logically
- Functional enough to demonstrate the concept
- Documented with setup and usage instructions

## User Testing

### Planning User Tests

When testing prototypes with users:

1. **Define Goals:** What do you want to learn?
2. **Create Test Plan:** What tasks will users perform?
3. **Recruit Participants:** Especially autistic individuals
4. **Prepare Materials:** Consent forms, instructions, prototypes
5. **Conduct Sessions:** Observe and take notes
6. **Analyze Results:** What did you learn?
7. **Iterate:** How will you improve the prototype?

### Autism-Inclusive Testing

- Provide clear instructions in writing
- Allow participants to control the environment (lighting, noise)
- Offer breaks as needed
- Don't require eye contact or verbal feedback
- Accept feedback in multiple formats (written, verbal, demonstration)
- Respect stimming and communication differences
- Ask about sensory experiences explicitly
- Compensate participants fairly for their time

### Documentation

Document user testing in `documentation/user-feedback/`:
- Test plan
- Participant demographics (anonymized)
- Observations and notes
- Key findings and insights
- Recommendations for improvements

## Prototype Iteration Process

1. **Build:** Create initial prototype based on requirements
2. **Test:** Verify functionality and gather data
3. **Document:** Record results, issues, and learnings
4. **Analyze:** What worked? What didn't? Why?
5. **Iterate:** Make improvements based on findings
6. **Repeat:** Continue cycle until goals are met

## Version Control

- Tag each major prototype version in Git
- Keep documentation in sync with prototype versions
- Maintain a CHANGELOG for significant prototypes
- Archive old versions but keep them accessible

## Prototype Maturity Levels

| Level | Description | Quality |
|-------|-------------|---------|
| **Alpha** | Very early, experimental | Rough, may not work |
| **Beta** | Functional but incomplete | Works but has issues |
| **RC** | Release candidate | Nearly production-ready |
| **Production** | Ready for real use | Fully functional and tested |

## Hardware Prototype Safety Notice

**⚠️ IMPORTANT SAFETY INFORMATION ⚠️**

All hardware prototypes are EXPERIMENTAL and may have safety issues:

- **Never leave prototypes unattended** while powered
- **Do not wear prototypes** until safety is verified
- **Keep fire extinguisher nearby** when testing batteries
- **Use current-limited power supplies** for testing
- **Verify all connections** before applying power
- **Test incrementally** - don't power everything at once
- **Have someone nearby** when testing for the first time
- **Respect electricity** - it can harm or kill

**Prototypes are NOT medical devices and should not be treated as such until proper safety testing and regulatory approval.**

## Resources

### Hardware Prototyping
- [KiCad Documentation](https://docs.kicad.org/)
- [Arduino Reference](https://www.arduino.cc/reference/en/)
- [Adafruit Learning System](https://learn.adafruit.com/)
- [SparkFun Tutorials](https://learn.sparkfun.com/)

### Firmware Development
- [ESP32 Documentation](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/)
- [Nordic nRF SDK](https://developer.nordicsemi.com/)
- [PlatformIO](https://platformio.org/) - Embedded development platform

### Software Prototyping
- [Figma Prototyping](https://help.figma.com/hc/en-us/articles/360040314193)
- [React Native](https://reactnative.dev/) - Mobile app development
- [Flutter](https://flutter.dev/) - Cross-platform mobile development

### User Testing
- [User Testing on a Budget](https://www.nngroup.com/articles/discount-usability-20-years/)
- [Inclusive Design Principles](https://inclusivedesignprinciples.org/)

## Contributing Prototypes

See [CONTRIBUTING.md](/Users/joelnewton/Desktop/2026-Code/tizzy/CONTRIBUTING.md) for general contribution guidelines.

### Prototype-Specific Guidelines

1. **Before Building:**
   - Review existing prototypes and documentation
   - Check if similar work has been done
   - Discuss significant prototypes in GitHub issues first

2. **During Development:**
   - Document as you go
   - Take photos/videos of the process
   - Note any issues or discoveries
   - Test thoroughly and safely

3. **Submitting Prototypes:**
   - Include all required documentation
   - Provide clear setup/usage instructions
   - Share test results and learnings
   - Explain what worked and what didn't
   - Suggest next steps or improvements

## Current Status

**Project Phase:** Planning / Pre-Development

No prototypes have been created yet. This is an open area for contribution!

### Planned Prototypes

**Phase 1 (Q2 2026):**
- Breadboard sensor testing
- Basic data logging firmware
- Simple mobile app mockup

**Phase 2 (Q3 2026):**
- PCB prototype v1
- Bluetooth communication firmware
- Interactive mobile app prototype

**Phase 3 (Q4 2026):**
- Integrated hardware prototype
- Full firmware with ML preprocessing
- Beta mobile application

## Questions?

- Open a GitHub issue with the `prototyping` label
- See [CONTRIBUTING.md](/Users/joelnewton/Desktop/2026-Code/tizzy/CONTRIBUTING.md) for how to get involved
- Join community discussions when available

---

**Last Updated:** 2026-02-13
