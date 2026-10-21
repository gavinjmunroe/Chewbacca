# Contributing to Tizzy

**Version:** 1.0
**Last Updated:** February 13, 2026

Thank you for contributing to Tizzy! This guide ensures our code maintains high quality while staying true to our mission: building assistive technology that empowers autistic people.

---

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Getting Started](#getting-started)
3. [Development Workflow](#development-workflow)
4. [Code Standards](#code-standards)
5. [Testing Requirements](#testing-requirements)
6. [Privacy & Security Guidelines](#privacy--security-guidelines)
7. [Documentation Standards](#documentation-standards)
8. [Pull Request Process](#pull-request-process)
9. [Review Guidelines](#review-guidelines)
10. [Specialized Contribution Areas](#specialized-contribution-areas)

---

## Code of Conduct

### Our Values

**Tizzy's mission:** Build assistive technology that helps autistic people improve conversational skills while honoring their authentic identity.

### Expectations

1. **Respect autistic voices:** Autistic contributors and users have lived experience that informs our work
2. **Privacy first:** Every contribution must respect user privacy and data sovereignty
3. **Evidence-based:** Defer to clinical research and autistic community input
4. **Clarity over conformity:** Code should reflect our philosophy of authentic communication
5. **Collaboration:** Assume good intent, ask clarifying questions, help each other succeed

### Unacceptable Behavior

- Dismissing autistic voices or lived experience
- Implementing surveillance features disguised as "helpful"
- Conformity-based language in coaching ("act normal," "stop being weird")
- Privacy shortcuts for convenience
- Harassment, discrimination, or exclusionary behavior

**Reporting:** Contact [conduct@tizzy.ai] or team lead directly.

---

## Getting Started

### Prerequisites

1. **Read core documentation:**
   - [Product Philosophy](../docs/18-PRODUCT-PHILOSOPHY.md)
   - [MVP Scope](../docs/16-MVP-SCOPE.md)
   - [Architecture Overview](../docs/architecture.md)

2. **Complete setup:**
   - Follow [Development Setup Guide](./setup.md)
   - Verify all tests pass locally
   - Join team Slack

3. **Understand privacy architecture:**
   - Read [Privacy Architecture](../docs/privacy-architecture.md)
   - Complete privacy training (ask team lead)

### Finding Work

#### Good First Issues
Look for GitHub issues labeled:
- `good-first-issue`: Beginner-friendly
- `documentation`: Improve docs
- `help-wanted`: Team needs support

#### Claiming an Issue
1. Comment "I'd like to work on this"
2. Wait for team lead assignment
3. Ask questions before starting
4. Update issue if you get blocked

---

## Development Workflow

### Branch Naming

```bash
# Feature branches
feature/short-description
feature/haptic-intensity-control

# Bug fixes
fix/short-description
fix/bluetooth-reconnection

# Documentation
docs/short-description
docs/update-api-reference

# Refactoring
refactor/short-description
refactor/extract-audio-processing

# Security/Privacy
security/short-description
privacy/short-description
```

### Commit Message Format

**Use Conventional Commits:**

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Formatting, no code change
- `refactor`: Code restructuring, no behavior change
- `test`: Adding/updating tests
- `chore`: Build process, dependencies
- `privacy`: Privacy-related changes
- `security`: Security-related changes

**Examples:**

```bash
feat(mobile): Add haptic intensity control

Users can now adjust haptic vibration strength in settings.
Addresses feedback from pilot users who found default too strong.

Closes #123

---

fix(ml): Handle empty audio segments gracefully

Previously crashed when processing silent audio.
Now returns early with null result.

Fixes #456

---

privacy(backend): Add audit log for data access

All user data access now logged with timestamp, user, action.
Supports privacy dashboard transparency feature.

Part of #789
```

### Writing Good Commit Messages

✅ **Good:**
- `feat(mobile): Add daily micro-goal notification`
- `fix(ml): Reduce false positive rate for interruption detection`
- `privacy(backend): Encrypt audio features before cloud sync`

❌ **Bad:**
- `update stuff`
- `fix bug`
- `WIP`
- `asdf`

---

## Code Standards

### TypeScript / JavaScript

#### Style Guide

**Use:**
- TypeScript strict mode
- Functional programming patterns where appropriate
- Async/await over callbacks
- Meaningful variable names
- Single responsibility principle

**Formatting:**
- Prettier (configured in `.prettierrc`)
- 2-space indentation
- Semicolons required
- Single quotes for strings
- Trailing commas in arrays/objects

#### Example: Good TypeScript

```typescript
// Good: Clear types, functional, well-named
interface ConversationInsight {
  type: 'success' | 'improvement' | 'confusion';
  timestamp: number;
  confidence: number;
  message: string;
}

async function generateInsights(
  audioFeatures: AudioFeatures,
  userBaseline: UserBaseline
): Promise<ConversationInsight[]> {
  const insights = await mlService.analyze(audioFeatures);

  return insights
    .filter(insight => insight.confidence > CONFIDENCE_THRESHOLD)
    .map(insight => ({
      type: insight.type,
      timestamp: insight.timestamp,
      confidence: insight.confidence,
      message: generateUserFriendlyMessage(insight, userBaseline),
    }));
}
```

```typescript
// Bad: Unclear types, poor naming, imperative
async function doStuff(data: any): Promise<any> {
  let x = await thing(data);
  let result = [];
  for (let i = 0; i < x.length; i++) {
    if (x[i].conf > 0.5) {
      result.push(x[i]);
    }
  }
  return result;
}
```

#### React Native Components

```typescript
// Good: Functional component with hooks, typed props
interface MicroGoalCardProps {
  goal: string;
  completed: boolean;
  onComplete: () => void;
}

export function MicroGoalCard({
  goal,
  completed,
  onComplete
}: MicroGoalCardProps): JSX.Element {
  const theme = useTheme();

  return (
    <Card style={[styles.card, completed && styles.completed]}>
      <Card.Content>
        <Text variant="titleMedium">{goal}</Text>
      </Card.Content>
      <Card.Actions>
        <Button onPress={onComplete} disabled={completed}>
          {completed ? 'Completed ✓' : 'Mark Complete'}
        </Button>
      </Card.Actions>
    </Card>
  );
}
```

### Python (ML Pipeline)

#### Style Guide

**Use:**
- Black for formatting
- Type hints (PEP 484)
- Docstrings (Google style)
- pytest for testing
- Async where appropriate

**Formatting:**
- Black formatter (configured)
- 4-space indentation
- Maximum line length: 100 characters

#### Example: Good Python

```python
from typing import List, Optional
import numpy as np
from dataclasses import dataclass

@dataclass
class AudioFeatures:
    """Extracted acoustic features from audio segment.

    Attributes:
        pace: Speaking rate (words per minute)
        pitch_variance: Variance in fundamental frequency
        intensity: Average volume in dB
        pauses: List of pause durations in seconds
    """
    pace: float
    pitch_variance: float
    intensity: float
    pauses: List[float]


async def extract_audio_features(
    audio: np.ndarray,
    sample_rate: int = 16000
) -> Optional[AudioFeatures]:
    """Extract acoustic features from audio signal.

    Args:
        audio: Audio signal as numpy array
        sample_rate: Sample rate in Hz

    Returns:
        AudioFeatures if successful, None if audio is invalid

    Raises:
        ValueError: If sample_rate is invalid
    """
    if sample_rate <= 0:
        raise ValueError(f"Invalid sample_rate: {sample_rate}")

    if len(audio) == 0:
        return None

    pace = await calculate_speaking_rate(audio, sample_rate)
    pitch_variance = calculate_pitch_variance(audio, sample_rate)
    intensity = calculate_intensity(audio)
    pauses = detect_pauses(audio, sample_rate)

    return AudioFeatures(
        pace=pace,
        pitch_variance=pitch_variance,
        intensity=intensity,
        pauses=pauses
    )
```

### Embedded C/C++ (Hardware)

#### Style Guide

**Use:**
- Consistent indentation (2 or 4 spaces)
- Clear variable names
- Comments for non-obvious code
- Memory safety practices
- Power optimization

#### Example: Good C++

```cpp
// Good: Clear structure, memory-safe, documented
class AudioCapture {
public:
    AudioCapture(uint8_t i2s_port, size_t buffer_size);
    ~AudioCapture();

    // Start continuous audio capture
    bool start();

    // Stop capture and cleanup
    void stop();

    // Get next audio buffer (non-blocking)
    // Returns nullptr if no data available
    const int16_t* getNextBuffer(size_t* length);

private:
    uint8_t port_;
    size_t buffer_size_;
    int16_t* buffer_;
    bool is_running_;

    void initializeI2S();
    void cleanupI2S();
};
```

---

## Testing Requirements

### Required Tests

**Every PR must include tests. No exceptions.**

#### Unit Tests

Test individual functions/components in isolation.

```typescript
// TypeScript/Jest example
describe('generateInsights', () => {
  it('filters low-confidence insights', async () => {
    const features = mockAudioFeatures();
    const baseline = mockUserBaseline();

    const insights = await generateInsights(features, baseline);

    expect(insights.every(i => i.confidence >= 0.85)).toBe(true);
  });

  it('returns empty array for silent audio', async () => {
    const features = mockSilentAudio();
    const baseline = mockUserBaseline();

    const insights = await generateInsights(features, baseline);

    expect(insights).toEqual([]);
  });
});
```

```python
# Python/pytest example
def test_extract_audio_features_with_valid_audio():
    """Should extract features from valid audio signal."""
    audio = generate_test_audio(duration=5.0, sample_rate=16000)

    features = extract_audio_features(audio, sample_rate=16000)

    assert features is not None
    assert features.pace > 0
    assert 0 <= features.intensity <= 120  # dB range


def test_extract_audio_features_with_empty_audio():
    """Should return None for empty audio."""
    audio = np.array([])

    features = extract_audio_features(audio)

    assert features is None
```

#### Integration Tests

Test components working together.

```typescript
describe('Conversation Analysis Pipeline', () => {
  it('processes audio end-to-end', async () => {
    const audioFile = loadTestAudio('conversation.wav');

    // Upload audio
    const uploadResponse = await uploadAudio(audioFile);
    expect(uploadResponse.status).toBe(200);

    // Wait for processing
    await waitForProcessing(uploadResponse.sessionId);

    // Fetch insights
    const insights = await fetchInsights(uploadResponse.sessionId);

    expect(insights.length).toBeGreaterThan(0);
    expect(insights[0]).toHaveProperty('type');
    expect(insights[0]).toHaveProperty('message');
  });
});
```

#### Privacy Tests

Test privacy-critical paths.

```typescript
describe('Audio Encryption', () => {
  it('encrypts audio before cloud sync', async () => {
    const audioBuffer = generateTestAudio();

    const encrypted = await encryptAudio(audioBuffer, userKey);

    // Encrypted data should be different from original
    expect(encrypted).not.toEqual(audioBuffer);

    // Should not be decryptable without key
    expect(() => decryptAudio(encrypted, wrongKey)).toThrow();

    // Should be decryptable with correct key
    const decrypted = await decryptAudio(encrypted, userKey);
    expect(decrypted).toEqual(audioBuffer);
  });
});
```

### Test Coverage Requirements

- **Minimum coverage:** 80% overall
- **Privacy-critical code:** 100% coverage
- **Security-critical code:** 100% coverage
- **UI components:** 70% (harder to test, but still required)

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test path/to/test.spec.ts

# Run in watch mode (during development)
npm run test:watch

# Run integration tests (slower)
npm run test:integration
```

---

## Privacy & Security Guidelines

### Privacy-Critical Code Review

**Before writing privacy-critical code:**
1. Read [Privacy Architecture](../docs/privacy-architecture.md)
2. Discuss approach with privacy lead
3. Document data flow
4. Add explicit tests

**Privacy-critical code includes:**
- Audio capture and storage
- Encryption and decryption
- User data access and deletion
- Consent mechanisms
- Audit logging

### Security Checklist

**Every PR touching these areas requires security review:**

- [ ] Authentication/authorization
- [ ] Encryption/decryption
- [ ] API endpoints accepting user input
- [ ] Database queries (SQL injection risk)
- [ ] File uploads
- [ ] Third-party API calls
- [ ] Environment variables/secrets

### Secure Coding Practices

#### Never Do This:

```typescript
// ❌ SQL injection vulnerability
const user = await db.query(`SELECT * FROM users WHERE id = ${userId}`);

// ❌ Hardcoded secrets
const API_KEY = 'sk-abc123';

// ❌ Logging sensitive data
console.log('User audio:', audioBuffer);

// ❌ Unencrypted storage of sensitive data
localStorage.setItem('userVoice', audioData);
```

#### Do This Instead:

```typescript
// ✅ Parameterized query
const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);

// ✅ Environment variables
const API_KEY = process.env.MODULATE_API_KEY;

// ✅ Log safely (no PII)
console.log('Processing audio chunk', { length: audioBuffer.length });

// ✅ Encrypted storage
const encrypted = await encrypt(audioData, userKey);
await secureStorage.set('userVoice', encrypted);
```

---

## Documentation Standards

### Code Documentation

**Required documentation:**

#### TypeScript/JavaScript
```typescript
/**
 * Generate user-friendly coaching message from ML insight.
 *
 * Uses user baseline to personalize message and avoid generic advice.
 * Ensures message uses clarity-focused language, not conformity-based.
 *
 * @param insight - Raw ML model output
 * @param baseline - User's personal communication baseline
 * @returns User-friendly coaching message
 *
 * @example
 * const message = generateUserFriendlyMessage(
 *   { type: 'interruption', confidence: 0.9 },
 *   userBaseline
 * );
 * // Returns: "They were still talking. Try waiting 2 seconds."
 */
function generateUserFriendlyMessage(
  insight: MLInsight,
  baseline: UserBaseline
): string {
  // Implementation...
}
```

#### Python
```python
def calculate_speaking_rate(
    audio: np.ndarray,
    sample_rate: int
) -> float:
    """Calculate speaking rate in words per minute.

    Uses voice activity detection to exclude pauses from calculation.

    Args:
        audio: Audio signal as numpy array
        sample_rate: Sample rate in Hz

    Returns:
        Speaking rate in words per minute (WPM)

    Raises:
        ValueError: If audio is empty or sample_rate is invalid

    Note:
        Accuracy depends on clear speech. Very fast or very slow speech
        may produce less accurate results.
    """
    # Implementation...
```

### Inline Comments

**When to comment:**
- Non-obvious business logic
- Privacy/security decisions
- Performance optimizations
- Workarounds for bugs/limitations

**Example:**

```typescript
// Privacy: We intentionally discard raw audio after feature extraction
// to minimize data retention. Only acoustic features are kept.
const features = await extractFeatures(audio);
audio = null; // Explicit cleanup to allow garbage collection

// Performance: Batch processing reduces API calls by 80%
const batchSize = 10;
const batches = chunk(insights, batchSize);
```

### README Files

Every major directory should have a README explaining:
- Purpose of the directory
- Key files/modules
- How to run/test
- Common issues

---

## Pull Request Process

### Before Opening PR

1. **Tests pass locally:**
   ```bash
   npm test
   npm run lint
   npm run type-check
   ```

2. **Code is formatted:**
   ```bash
   npm run format
   ```

3. **Documentation updated:**
   - Update relevant docs
   - Add/update code comments
   - Update CHANGELOG if user-facing

4. **Privacy/security review needed?**
   - Tag `privacy-review` or `security-review` label
   - Ping privacy/security lead in PR

### PR Template

```markdown
## Description
Brief description of what this PR does.

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update
- [ ] Privacy/security change

## Related Issue
Closes #123

## How Has This Been Tested?
Describe testing approach:
- [ ] Unit tests added
- [ ] Integration tests added
- [ ] Manual testing performed
- [ ] Tested on device/emulator

## Privacy/Security Considerations
Does this PR touch sensitive data or security-critical paths?
If yes, describe approach and safeguards.

## Screenshots (if applicable)
For UI changes, add before/after screenshots.

## Checklist
- [ ] Tests pass locally
- [ ] Code is formatted
- [ ] Documentation updated
- [ ] No console.logs or debug code
- [ ] Privacy implications considered
- [ ] Accessibility tested (if UI change)
```

### PR Size Guidelines

**Keep PRs small and focused:**
- ✅ Good: <500 lines changed
- ⚠️ Acceptable: 500-1000 lines
- ❌ Too large: >1000 lines (split into multiple PRs)

**If PR is large:**
- Explain why in description
- Consider breaking into smaller PRs
- Provide extra context for reviewers

---

## Review Guidelines

### As a Reviewer

**What to look for:**

1. **Correctness:**
   - Does code do what PR says?
   - Are edge cases handled?
   - Are tests comprehensive?

2. **Code quality:**
   - Readable and maintainable?
   - Follows standards?
   - Well-documented?

3. **Privacy/security:**
   - Any sensitive data exposure?
   - Proper encryption/authentication?
   - Audit logging where needed?

4. **Product alignment:**
   - Does this serve our mission?
   - Is coaching language clarity-focused?
   - Does this respect user autonomy?

**How to give feedback:**

✅ **Good feedback:**
```
This looks good overall! A few suggestions:

1. Line 45: Consider adding null check here for edge case when
   user has no baseline yet.

2. Line 78: This coaching message feels a bit conformity-focused.
   Maybe rephrase as "They might not understand. Try explaining
   differently?" instead of "You're being unclear."

3. Nice work on the tests! Could we add one more for the empty
   audio case?
```

❌ **Bad feedback:**
```
This is wrong. Redo it.
```

### Approval Process

**Required approvals:**
- Standard PR: 1 approval from team member
- Privacy-critical: 1 approval + privacy lead sign-off
- Security-critical: 1 approval + security lead sign-off
- Breaking change: 2 approvals + tech lead sign-off

### Merging

1. **Squash and merge** (preferred for most PRs)
   - Keeps history clean
   - One commit per feature

2. **Merge commit** (for complex multi-commit PRs)
   - Preserves individual commits
   - Use when commit history is meaningful

3. **Rebase and merge** (rare)
   - Use only when specifically needed

**Delete branch after merge.**

---

## Specialized Contribution Areas

### Hardware Development

**Additional requirements:**
- Test on physical device (not just emulator)
- Document power consumption impact
- Consider battery life implications
- Audio quality validation

**Hardware PR checklist:**
- [ ] Tested on dev kit hardware
- [ ] Power consumption measured
- [ ] No memory leaks
- [ ] Bluetooth stability verified

### ML/AI Development

**Additional requirements:**
- Document model architecture changes
- Provide accuracy metrics (precision, recall, F1)
- Bias analysis for new models
- Explain confidence thresholds

**ML PR checklist:**
- [ ] Model accuracy benchmarked
- [ ] False positive rate measured
- [ ] Bias analysis completed
- [ ] Inference latency acceptable

### Privacy-Critical Changes

**Additional requirements:**
- Privacy impact assessment
- Data flow diagram
- Retention policy documentation
- Audit logging implementation

**Privacy PR checklist:**
- [ ] Privacy lead reviewed
- [ ] Data flow documented
- [ ] Encryption verified
- [ ] Audit logging added
- [ ] User control mechanisms included

---

## Accessibility Guidelines

**All UI changes must consider accessibility:**

- [ ] Screen reader compatible (use semantic HTML/components)
- [ ] Sufficient color contrast (WCAG AA minimum)
- [ ] Keyboard navigable
- [ ] Touch targets ≥44x44 points
- [ ] Text scales with system font size
- [ ] Animations can be disabled (respect prefers-reduced-motion)

**Test with:**
- VoiceOver (iOS)
- TalkBack (Android)
- Keyboard-only navigation

---

## Performance Guidelines

**Profile before optimizing:**
- Don't optimize prematurely
- Measure impact with benchmarks
- Document tradeoffs

**Performance budgets:**
- App launch: <3 seconds
- Screen transitions: <300ms
- API response: <500ms (p95)
- Audio processing: <2 seconds for 5-minute clip

**Common performance issues:**
- Unnecessary re-renders (React)
- Blocking main thread (use workers)
- Large bundle size (code splitting)
- Memory leaks (cleanup listeners)

---

## Internationalization (Future)

**When adding user-facing strings:**

```typescript
// Do this (ready for i18n)
import { t } from '@/i18n';

const message = t('coaching.interruption', {
  pauseSeconds: 2
});
// "They were still talking. Try waiting 2 seconds."

// Not this (hardcoded English)
const message = "They were still talking. Try waiting 2 seconds.";
```

---

## Getting Help

### When You're Stuck

1. **Search documentation** and existing issues
2. **Ask in Slack:** #dev-help channel
3. **Pair programming:** Request pairing session
4. **Office hours:** Tech lead holds office hours Wednesdays 2-4pm

### Asking Good Questions

✅ **Good question:**
```
I'm working on haptic intensity control (PR #123). The intensity
setting persists correctly, but the haptic motor doesn't respond
to the new value until app restart.

I've checked:
- Value saves to storage ✓
- Value loads on app start ✓
- Bluetooth command sends new value ✓

But the motor seems to cache the old value. Any ideas where to
look next? Relevant code: mobile/src/bluetooth/haptics.ts
```

❌ **Bad question:**
```
Haptics don't work. Help?
```

---

## Recognition and Growth

### Contributing to Your Growth

**We value contributions beyond code:**
- Documentation improvements
- Helping other contributors
- User research participation
- Design feedback
- Community engagement

**Growth opportunities:**
- Lead features (after 3+ successful PRs)
- Mentor new contributors
- Give tech talks (team demos)
- Write blog posts (external)

**Performance reviews consider:**
- Code quality and consistency
- Collaboration and communication
- Alignment with mission and values
- Impact (not just output)

---

## Questions?

**This guide is living documentation.**

If something is unclear or missing:
1. Open an issue with `docs` label
2. Submit a PR to improve it
3. Ask in #dev-general Slack

**Maintainer:** Tech Lead
**Last Updated:** February 13, 2026
**Version:** 1.0

---

## Thank You

Thank you for contributing to Tizzy. Your work helps autistic people understand and improve their conversations while honoring their authentic identity.

**Every contribution matters. Every line of code serves our mission.**

Let's build something great together.
