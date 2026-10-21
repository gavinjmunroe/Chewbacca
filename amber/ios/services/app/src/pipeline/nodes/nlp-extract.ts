import { registerNode } from '../engine.js';

// NLP extraction node: takes natural language input and extracts person/relationship entities
registerNode('nlp.extract', async (input) => {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  
  // Improved pattern matching for name extraction
  const lowerText = text.toLowerCase();
  
  // Common words to skip (including action verbs and common phrases)
  const skipWords = new Set([
    'had', 'has', 'have', 'a', 'an', 'the', 'is', 'was', 'are', 'were',
    'son', 'sons', 'daughter', 'daughters', 'child', 'children',
    'father', 'mother', 'parent', 'parents', 'brother', 'sister',
    'sibling', 'husband', 'wife', 'partner', 'spouse', 'named',
    'called', 'who', 'which', 'that', 'this', 'these', 'those', 'and', 'or',
    'remove', 'delete', 'add', 'create', 'everyone', 'family', 'in', 'the',
    'all', 'each', 'every', 'some', 'any', 'no', 'not'
  ]);
  
  // Split by common separators
  let processedText = text;
  const separators = [' and ', ', ', ' & ', ' named ', ' called '];
  for (const sep of separators) {
    processedText = processedText.replace(new RegExp(sep, 'gi'), ' | ');
  }
  
  const words = processedText.split(/\s+/);
  const extractedNames = new Set<string>();
  let currentName = '';
  
  for (const word of words) {
    const clean = word.replace(/[.,!?]/g, '').toLowerCase();
    
    // Handle separator marker
    if (word === '|') {
      if (currentName.trim().length > 1 && !skipWords.has(currentName.trim().toLowerCase())) {
        extractedNames.add(capitalizeName(currentName.trim()));
      }
      currentName = '';
      continue;
    }
    
    // Check if word starts with capital (likely a name)
    if (word.length > 0 && word[0] === word[0].toUpperCase() && word[0] !== word[0].toLowerCase()) {
      const cleanWord = word.replace(/[.,!?]/g, '');
      if (cleanWord.length > 1 && !skipWords.has(cleanWord.toLowerCase())) {
        if (currentName) {
          currentName += ' ' + cleanWord;
        } else {
          currentName = cleanWord;
        }
      }
    } else if (currentName && !skipWords.has(clean)) {
      // Continue building name
      currentName += ' ' + word.replace(/[.,!?]/g, '');
    }
  }
  
  // Add final name
  if (currentName.trim().length > 1 && !skipWords.has(currentName.trim().toLowerCase())) {
    extractedNames.add(capitalizeName(currentName.trim()));
  }
  
  // Fallback: extract standalone capitalized words
  for (const word of words) {
    const clean = word.replace(/[.,!?]/g, '');
    if (clean.length > 2 && 
        clean[0] === clean[0].toUpperCase() && 
        clean[0] !== clean[0].toLowerCase() &&
        !skipWords.has(clean.toLowerCase())) {
      extractedNames.add(capitalizeName(clean));
    }
  }
  
  const persons: Array<{ name: string; dob?: string }> = [];
  const relationships: Array<{ from: string; to: string; type: string }> = [];
  
  // Extract relationship types
  let relType = 'other';
  if (lowerText.includes('son') || lowerText.includes('child')) {
    relType = 'child';
  } else if (lowerText.includes('father') || lowerText.includes('dad') || lowerText.includes('parent')) {
    relType = 'parent';
  } else if (lowerText.includes('brother') || lowerText.includes('sister') || lowerText.includes('sibling')) {
    relType = 'sibling';
  } else if (lowerText.includes('husband') || lowerText.includes('wife') || lowerText.includes('partner') || lowerText.includes('spouse')) {
    relType = 'partner';
  }
  
  // Create persons from extracted names
  const uniqueNames = Array.from(extractedNames);
  uniqueNames.forEach((name) => {
    persons.push({ name });
  });
  
  // Create relationships if we have names and a relationship type
  if (uniqueNames.length >= 2 && relType !== 'other') {
    // Assume first name is the subject, rest are related
    for (let i = 1; i < uniqueNames.length; i++) {
      relationships.push({
        from: uniqueNames[0],
        to: uniqueNames[i],
        type: relType,
      });
    }
  }
  
  return {
    persons,
    relationships,
    rawText: text,
  };
});

function capitalizeName(name: string): string {
  return name.split(' ').map(word => 
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(' ');
}

