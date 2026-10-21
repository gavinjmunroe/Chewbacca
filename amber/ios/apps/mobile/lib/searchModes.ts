// WHAT THE ONE BAR IS, PER TAB.
//
// There is a single bottom bar for the whole app. It is the same bar on every
// tab -- same object, same position, never re-mounted -- and what changes as you
// move between them is three things and only three things:
//
//   1. the words inside it          (placeholder)
//   2. which controls it carries    (trailing actions)
//   3. WHAT IT DOES WITH THE TEXT   (kind)
//
// Those three live here as data, not as three hand-styled bars that have to be
// kept in agreement. The four attempts before this one failed because the bar was
// more than one component: sharing a height, then a shell, then a wrapper inset
// each closed one gap and left the next open. This closes the category.
//
// It used to be keyed on which of the two PEOPLE PAGES you were on, because Ask
// was the second half of the People tab. Ask now belongs to Home and to Profile,
// People is a single page, and the key is the tab.

export type SearchModeId = 'today' | 'you' | 'ask';

/** What the bar does with what you type. The backend, in one word. */
export type SearchKind =
  // Live keyword filter over the address book already on the device. No network,
  // no model, results as you type.
  //
  // NOTHING USES THIS ANY MORE and it is deliberately still here. The People tab
  // was the one keyword surface, and its address book moved into the Messages
  // panel, which carries its own field next to the list it filters -- a filter
  // belongs beside the thing it filters, not at the other end of the screen. The
  // kind stays because the dock's behavior is a table rather than a set of
  // branches, and the table having a name for "filter what is on screen" is what
  // lets the next such surface be one line instead of a second bar.
  | 'keyword'
  // The full agent: your contacts, your notes, and the open web. Submitted on
  // send rather than per keystroke, because each one is a real request.
  | 'agent';

export type SearchMode = {
  id: SearchModeId;
  kind: SearchKind;
  /** The words inside the bar. */
  placeholder: string;
  /** Screen-reader name for the field. */
  label: string;
  /** Trailing controls, in order. The RECORD BUTTON IS NOT LISTED: it leads every
   *  mode, on every tab, because holding a thought is never tab-specific. */
  trailing: readonly ('clear' | 'send')[];
  /** Submit on every keystroke, or only when sent. */
  submitsWhileTyping: boolean;
};

/**
 * THE FULL AGENT: your people, your notes, and the open web. Submitted on send
 * rather than per keystroke, because each one is a real request.
 *
 * One object, shared by every surface that offers it -- Today, You, and (with its
 * own words) an open note. `id` is filled in by the table so the surfaces stay
 * addressable while the BEHAVIOR has exactly one definition.
 */
const ASK_ANYTHING: SearchMode = {
  id: 'today',
  kind: 'agent',
  // ONE WORD. It was "Tell Amber, or search", which is the field explaining
  // itself -- and a placeholder that explains itself is a placeholder nobody
  // reads twice. The rendering says "Search"; what the field actually does is
  // unchanged, and the `label` below is what a screen reader gets.
  placeholder: 'Search',
  label: 'Tell Amber something, or ask about your network',
  trailing: ['send'],
  submitsWhileTyping: false,
};

export const SEARCH_MODES: Record<SearchModeId, SearchMode> = {
  today: ASK_ANYTHING,
  // THE SAME OBJECT, NOT A COPY OF IT.
  //
  // "The search bar for the You page and the home page should be the same one,
  //  since they have the same functionality. Search bars should be components
  //  based on their functionality."
  //
  // They already were the same COMPONENT -- one SearchDock, rendered once above
  // the pager, never re-mounted as you move between tabs. But this table listed
  // Today and You as two separate literals with identical fields, on the argument
  // that they could diverge later. That is duplication defending a hypothetical,
  // and the concrete cost is real: the two were already out of step once (You
  // said "Search your circles", which undersold what the field actually does) and
  // nothing would have caught it.
  //
  // Same functionality, one definition. Both ids now point at ASK_ANYTHING, so
  // they cannot drift by a word. If they ever genuinely need to differ, the fix
  // is to spread it and override the field that differs -- which is what `ask`
  // below does, because its words are legitimately scoped to a note.
  //
  // scripts/search-modes-check.mts asserts the two resolve to identical
  // behavior, so a future edit cannot quietly split them again.
  you: ASK_ANYTHING,
  // INSIDE AN OPEN NOTE, a voice chat, a journal entry, a reminder.
  //
  // Identical behavior to `today` and `you` -- it is the same agent, the same
  // web and network search, the same PeopleRank -- and it exists as its own id
  // for one reason: these surfaces are not a tab, so `modeForTab` cannot name
  // them, and the dock used to take a tab INDEX. A surface that is not a tab
  // could not ask for a bar, which is why opening a note lost it.
  ask: {
    ...ASK_ANYTHING,
    id: 'ask',
    // The one field that legitimately differs: inside an open note the question
    // is about THIS thing first. Everything else -- the backend, the controls,
    // when it submits -- is the shared definition above.
    placeholder: 'Ask about this, or anything',
    label: 'Ask Amber about this note, or anything else',
  },
};

/**
 * Which mode a settled tab index is in. 0 Home, 1 You.
 *
 * BOTH ANSWERS ARE THE SAME OBJECT (see the note on `you` above), so this is
 * currently a function that cannot return two different behaviors. It is kept
 * as a function rather than collapsed to a constant because the dock takes a
 * mode id and the ids are how the two surfaces stay addressable -- and because
 * the day either tab wants a different bar, this is the one line that changes
 * instead of a call site somewhere in home.tsx.
 */
export function modeForTab(tab: number): SearchModeId {
  return tab <= 0 ? 'today' : 'you';
}
