# Wireframes

This directory contains wireframes and low-fidelity mockups for the Tizzy project.

## Purpose

Wireframes help us:
- Visualize user interfaces before development
- Plan information architecture and user flows
- Communicate design concepts to stakeholders
- Gather feedback early in the design process
- Ensure accessibility and usability from the start

## Organization

Wireframes should be organized by:

```
wireframes/
├── mobile-app/
│   ├── onboarding/
│   ├── dashboard/
│   ├── settings/
│   └── data-visualization/
├── web-dashboard/
│   ├── admin/
│   ├── user-portal/
│   └── analytics/
├── firmware-ui/
│   └── device-interface/
└── iterations/
    ├── v1/
    ├── v2/
    └── current/
```

## File Formats

Preferred formats:
- **Figma** (.fig) - Primary design tool (recommended)
- **Sketch** (.sketch) - Alternative
- **Adobe XD** (.xd) - Alternative
- **PNG/JPG** - Exported images for quick reference
- **PDF** - For presentations and documentation
- **SVG** - For vector graphics

## Naming Conventions

Use clear, descriptive names:
```
[component]-[screen/feature]-[version]-[status].ext

Examples:
mobile-app-dashboard-v1-draft.fig
web-portal-settings-v2-review.png
firmware-menu-navigation-v1-approved.pdf
```

## Design Principles

All wireframes should follow:

### Accessibility First
- High contrast for visibility
- Clear hierarchy and layout
- Support for screen readers (documented in annotations)
- Touch targets minimum 44x44pt
- Clear labels and instructions

### Autism-Inclusive Design
- Minimal sensory overwhelm (reduce clutter, avoid flashy animations)
- Clear, literal language
- Predictable navigation patterns
- Customizable sensory preferences (color schemes, animations, sounds)
- Multiple ways to access information
- Progress indicators for multi-step processes

### Mobile-First
- Design for small screens first
- Responsive layouts
- Touch-friendly interactions
- Consider one-handed use

### Data Privacy
- Clear indication of what data is collected
- Transparent privacy controls
- Easy access to data management

## Wireframing Checklist

Before finalizing wireframes, ensure:

- [ ] All screens in the user flow are documented
- [ ] Navigation paths are clear and logical
- [ ] Accessibility considerations are annotated
- [ ] Customization options are indicated
- [ ] Error states and edge cases are included
- [ ] Mobile and desktop versions (if applicable)
- [ ] Loading states and transitions are documented
- [ ] Annotations explain key decisions and interactions
- [ ] Color contrast meets WCAG 2.1 AA standards (minimum)
- [ ] Text is readable (minimum 16px for body text)

## User Flows to Include

Key user flows for Tizzy:

1. **Onboarding**
   - Initial setup and device pairing
   - Permission requests and privacy settings
   - Profile creation and preferences

2. **Daily Use**
   - View current sensory data
   - Log manual observations
   - Check alerts or patterns

3. **Data Review**
   - View historical data
   - Identify patterns
   - Export data

4. **Settings & Customization**
   - Adjust sensory preferences
   - Configure alerts
   - Manage privacy settings
   - Update profile

5. **Device Management**
   - Pair/unpair device
   - Update firmware
   - Check battery and status

## Tools and Resources

### Design Tools
- **Figma** (https://figma.com) - Collaborative design tool (recommended)
- **Balsamiq** (https://balsamiq.com) - Quick wireframing tool
- **Whimsical** (https://whimsical.com) - Simple wireframes and flows
- **Paper & Pencil** - Always valid for initial sketches!

### Accessibility Resources
- **WCAG 2.1 Guidelines:** https://www.w3.org/WAI/WCAG21/quickref/
- **Contrast Checker:** https://webaim.org/resources/contrastchecker/
- **Material Design Accessibility:** https://material.io/design/usability/accessibility.html
- **iOS Accessibility:** https://developer.apple.com/accessibility/
- **Android Accessibility:** https://developer.android.com/guide/topics/ui/accessibility

### Autism-Inclusive Design Resources
- Autistic Self Advocacy Network (ASAN) resources
- Understood.org sensory processing guides
- Neurodiversity design guidelines

## Feedback and Iteration

### Review Process

1. **Draft:** Initial wireframes, open for feedback
2. **Review:** Shared with team and community for input
3. **Revised:** Updated based on feedback
4. **Approved:** Ready for high-fidelity design or development

### Getting Feedback

- Share wireframes in GitHub discussions or issues
- Tag relevant stakeholders
- Include specific questions or areas of concern
- Document feedback and changes in comments or separate files

### Version Control

- Save iterations in the `iterations/` folder
- Keep version numbers in filenames
- Document major changes in a separate CHANGES.md file (if needed)

## Contributing Wireframes

See [CONTRIBUTING.md](/Users/joelnewton/Desktop/2026-Code/tizzy/CONTRIBUTING.md) for general contribution guidelines.

### Wireframe-Specific Guidelines

1. **Before You Start:**
   - Review existing wireframes
   - Check GitHub issues for design tasks
   - Discuss major changes before investing significant time

2. **Creating Wireframes:**
   - Follow accessibility and autism-inclusive principles
   - Include annotations explaining design decisions
   - Consider multiple screen sizes and orientations
   - Document interactive elements and transitions

3. **Submitting Wireframes:**
   - Export to multiple formats (source file + PNG/PDF)
   - Include a brief description of the wireframe
   - Note any specific feedback you're seeking
   - Reference related issues or user stories

## Status

**Current Phase:** Planning / Pre-Development

No wireframes have been created yet. This is an open area for contribution!

## Questions?

- Open a GitHub issue with the `design` or `wireframes` label
- See [CONTRIBUTING.md](/Users/joelnewton/Desktop/2026-Code/tizzy/CONTRIBUTING.md) for how to get involved

---

**Last Updated:** 2026-02-13
