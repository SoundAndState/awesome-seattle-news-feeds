import {Fragment} from 'react';
import {messageParts} from '../localization.mjs';

// React escapes text and values; rich placeholders are explicit elements.
export function Message({message, values}) {
  return messageParts(message, values).map((part, index) => <Fragment key={index}>{part}</Fragment>);
}
