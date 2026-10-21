# Contributing to Tizzy

Thank you for your interest in contributing to Tizzy! This project aims to empower individuals on the autism spectrum with assistive technology, and we welcome contributions from everyone, especially those with lived experience of autism.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
- [Getting Started](#getting-started)
- [Development Process](#development-process)
- [Contribution Guidelines](#contribution-guidelines)
- [Review Process](#review-process)
- [Community](#community)
- [Recognition](#recognition)

---

## Code of Conduct

This project adheres to an autism-inclusive Code of Conduct. By participating, you are expected to uphold this code. Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

**Key Principles:**
- Respect neurodiversity and different communication styles
- Assume good intent and communicate clearly
- Be patient and supportive, especially with first-time contributors
- Center the voices and experiences of autistic individuals
- Prioritize accessibility in all contributions

---

## How Can I Contribute?

There are many ways to contribute to Tizzy, regardless of your technical background:

### 1. Lived Experience & User Feedback

**This is one of the most valuable contributions!**

- Share your experiences with sensory processing and meltdowns/shutdowns
- Participate in user testing and provide feedback
- Suggest features that would be helpful for you
- Review designs and documentation for accessibility
- Help us understand what works and what doesn't

**How to contribute:**
- Open an issue labeled `user-feedback`
- Join community discussions (details TBD)
- Participate in user testing sessions when available

### 2. Documentation

- Improve existing documentation for clarity
- Add examples and use cases
- Translate documentation to other languages
- Create tutorials and guides
- Document accessibility features
- Improve README files

### 3. Design

- Create or improve UI/UX designs
- Design icons, graphics, and visual assets
- Conduct accessibility audits
- Create wireframes and prototypes
- Provide feedback on design decisions

### 4. Code Contributions

- Fix bugs
- Implement new features
- Improve performance
- Add tests
- Refactor code for better maintainability
- Improve error handling and logging

### 5. Hardware & Electronics

- Improve PCB designs
- Optimize sensor selection and placement
- Suggest enclosure designs
- Test hardware prototypes
- Improve power efficiency
- Create manufacturing documentation

### 6. Research & Data Science

- Analyze sensory data patterns
- Improve machine learning models
- Conduct literature reviews
- Validate scientific approaches
- Ensure ethical data practices
- Contribute to research documentation

### 7. Testing & Quality Assurance

- Test features and report bugs
- Create test cases
- Perform accessibility testing
- Test across different devices and platforms
- Validate data accuracy
- Stress test systems

### 8. Community & Support

- Answer questions from other users
- Help moderate community spaces
- Organize events or meetups
- Create educational content
- Advocate for the project
- Connect us with relevant stakeholders

---

## Getting Started

### Prerequisites

Before you start contributing, please:

1. **Read the documentation:**
   - [README.md](README.md) - Project overview
   - [Master Documentation](/Users/joelnewton/Desktop/2026-Code/tizzy/docs/tizzy-master-doc.md) - Comprehensive technical details
   - [Code of Conduct](CODE_OF_CONDUCT.md) - Community guidelines

2. **Set up your environment:**
   - Install Git and create a GitHub account (for code contributions)
   - Review our development setup guide (TBD)
   - Familiarize yourself with our tech stack

3. **Understand our processes:**
   - Review this contributing guide completely
   - Check existing issues and pull requests
   - Join our communication channels (TBD)

### Finding Something to Work On

1. **Check the issue tracker:**
   - Look for issues labeled `good-first-issue` - perfect for newcomers
   - Issues labeled `help-wanted` - areas where we need support
   - Issues labeled `user-feedback-needed` - where lived experience is valuable

2. **Ask questions:**
   - Not sure where to start? Open a discussion or comment on an issue
   - We're happy to help you find a good fit for your skills and interests

3. **Propose new ideas:**
   - Have an idea? Open an issue to discuss it before investing significant time
   - We encourage creative thinking and new perspectives

---

## Development Process

### 1. Fork and Clone

```bash
# Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR-USERNAME/tizzy.git
cd tizzy

# Add the upstream repository
git remote add upstream https://github.com/TIZZY-ORG/tizzy.git
```

### 2. Create a Branch

Always create a new branch for your work:

```bash
# Update your main branch
git checkout main
git pull upstream main

# Create a new branch with a descriptive name
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
# or
git checkout -b docs/documentation-improvement
```

**Branch naming conventions:**
- `feature/description` - New features
- `fix/description` - Bug fixes
- `docs/description` - Documentation changes
- `refactor/description` - Code refactoring
- `test/description` - Adding or updating tests
- `hardware/description` - Hardware-related changes

### 3. Make Your Changes

- Write clear, readable code following our style guide (TBD)
- Include comments explaining complex logic
- Update documentation as needed
- Add tests for new functionality
- Ensure all tests pass

### 4. Commit Your Changes

Write clear, descriptive commit messages:

```bash
# Good commit message format:
# <type>: <short summary> (50 chars or less)
#
# <optional detailed description>
#
# <optional footer: issue references, breaking changes, etc.>

# Examples:
git commit -m "feat: add light sensor calibration feature"
git commit -m "fix: resolve data sync issue on iOS app"
git commit -m "docs: update installation instructions for Windows"
```

**Commit message types:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, no logic change)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks
- `hardware:` - Hardware design changes

### 5. Push and Create Pull Request

```bash
# Push your branch to your fork
git push origin feature/your-feature-name

# Go to GitHub and create a Pull Request
```

---

## Contribution Guidelines

### Code Quality

- **Readability:** Write code that is easy to understand
- **Documentation:** Comment complex logic and update relevant docs
- **Testing:** Include tests for new features or bug fixes
- **Accessibility:** Ensure UI changes are accessible (WCAG 2.1 AA minimum)
- **Privacy:** Never include sensitive data or API keys in commits

### Accessibility Requirements

All contributions must meet accessibility standards:

- **UI/UX:** Follow WCAG 2.1 Level AA guidelines
- **Documentation:** Use clear, plain language; avoid jargon when possible
- **Code:** Include ARIA labels, keyboard navigation support
- **Design:** Ensure sufficient color contrast, support for screen readers
- **Communication:** Provide multiple ways to access information

### Inclusive Design Principles

- **Neurodiversity-Affirming:** Design with autistic users, not for them
- **Customizable:** Support different sensory preferences and needs
- **Clear Communication:** Use direct language, avoid ambiguity
- **Flexible Interaction:** Support multiple input methods
- **Privacy-First:** Give users control over their data

### Documentation Standards

- Use Markdown for documentation files
- Include code examples where relevant
- Add diagrams or screenshots to clarify complex concepts
- Keep a clear hierarchy with headers
- Update table of contents when adding new sections

### Hardware Contributions

- **Design Files:** Use KiCad (preferred) or provide exportable formats
- **Documentation:** Include Bill of Materials (BOM), assembly instructions
- **Testing:** Document testing procedures and results
- **Licensing:** Ensure compatibility with project license
- **Safety:** Follow electrical safety standards

---

## Review Process

### What Happens After You Submit a PR?

1. **Automated Checks:**
   - Code formatting and linting (when configured)
   - Automated tests
   - Security scanning
   - License compliance checks

2. **Human Review:**
   - A maintainer will review your PR within 7 days
   - We may request changes or ask questions
   - Please respond to feedback promptly

3. **Community Input:**
   - For significant changes, we may request community feedback
   - User testing may be required for UI/UX changes

4. **Approval & Merge:**
   - Once approved, a maintainer will merge your PR
   - Your contribution will be included in the next release

### Review Criteria

We evaluate contributions based on:

- **Alignment:** Does it align with project goals and values?
- **Quality:** Is the code/design well-crafted and maintainable?
- **Accessibility:** Does it maintain or improve accessibility?
- **Documentation:** Are changes properly documented?
- **Testing:** Is there adequate testing or validation?
- **Impact:** Does it positively impact the user experience?

### Response Times

We aim to:
- Acknowledge new PRs within 2-3 days
- Complete initial review within 7 days
- Merge approved PRs within 14 days

Please be patient! All maintainers are volunteers or working on limited time.

---

## Communication Channels

### GitHub

- **Issues:** Bug reports, feature requests, questions
- **Discussions:** (TBD) Community conversations, ideas, Q&A
- **Pull Requests:** Code and documentation contributions

### Other Channels (TBD)

We're evaluating options for real-time communication that are autism-friendly:
- Text-based channels with no voice requirement
- Clear topic separation to avoid overwhelming discussions
- Asynchronous communication support
- No pressure for immediate responses

**Preferences we're considering:**
- Discord with well-organized channels
- Slack workspace
- Matrix/Element
- Discourse forum

We welcome input on what platforms would work best for our community!

---

## Recognition

### Contributors

All contributors will be recognized in:
- CHANGELOG.md for each release
- A dedicated CONTRIBUTORS.md file (TBD)
- Project website (when available)

### Types of Recognition

- **Code Contributors:** GitHub automatically tracks your commits
- **Non-Code Contributors:** Manually added to recognition files
- **Community Contributors:** Highlighted in project updates

### How to Be Recognized

For non-code contributions (feedback, testing, design, etc.), please:
1. Let us know you'd like to be recognized
2. Provide your preferred name and how you contributed
3. We'll add you to our contributors list

**Note:** Recognition is optional. You can contribute anonymously if preferred.

---

## Contributor License Agreement (CLA)

**Status:** TBD - pending final license selection

Once our license is finalized, we may require contributors to sign a CLA to ensure:
- We have the right to use and distribute contributions
- You retain ownership of your work
- Legal clarity for all parties

We will provide clear documentation when this is implemented.

---

## Questions?

### Where to Ask

- **General questions:** Open a GitHub issue with the `question` label
- **Contribution-specific:** Comment on the relevant issue or PR
- **Private/sensitive matters:** (Contact email TBD)

### Common Questions

**Q: I'm new to open source. Can I still contribute?**
A: Absolutely! We welcome first-time contributors and will provide guidance. Look for `good-first-issue` labels.

**Q: I'm autistic and have ideas but don't know how to code. Can I help?**
A: YES! Your lived experience is incredibly valuable. Share your ideas via GitHub issues or discussions.

**Q: Do I need to be autistic to contribute?**
A: No, but we center autistic voices in decision-making. All contributors are welcome if they support our mission and values.

**Q: I found a bug. What should I do?**
A: Open an issue with details about what happened, what you expected, and steps to reproduce the bug.

**Q: Can I work on an issue someone else is assigned to?**
A: Please ask first! If someone is assigned but hasn't responded in 14+ days, the issue may be available.

**Q: How do I report a security vulnerability?**
A: See our [Security Policy](SECURITY.md) - do NOT open a public issue.

---

## Additional Resources

- [Master Documentation](/Users/joelnewton/Desktop/2026-Code/tizzy/docs/tizzy-master-doc.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Changelog](CHANGELOG.md)
- Development setup guide (TBD)
- Style guide (TBD)
- Testing guide (TBD)

---

## Thank You!

Every contribution, no matter how small, makes a difference. Whether you're fixing a typo, suggesting a feature, or building core functionality, you're helping create technology that can improve lives.

Thank you for being part of the Tizzy community!

---

**Last Updated:** 2026-02-13
