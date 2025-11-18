import React from 'react';
import ReactMarkdown from 'react-markdown';

interface SynthesisTextProps {
  content: string;
}

export function SynthesisText({ content }: SynthesisTextProps) {
  if (!content) {
    return null;
  }

  return (
    <div className="text-gray-700 text-sm leading-relaxed">
      <ReactMarkdown
        components={{
          a: ({ node, href, children, ...props }) => {
            const url = href ?? '#';

            const handleClick: React.MouseEventHandler<HTMLAnchorElement> = (e) => {
              e.preventDefault();
              try {
                (window as any).openai?.openExternal?.({ href: url });
              } catch {
                // ignore
              }
            };

            return (
              <a
                {...props}
                href={url}
                onClick={handleClick}
                className="text-[#007EFF] font-medium py-0.5 px-0.5 -mx-0.5 rounded-md hover:opacity-80 cursor-pointer bg-[#edf5ff]"
              >
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
