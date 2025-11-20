import React from 'react';
import { SynthesisText } from './SynthesisText';

interface ConnectionCardProps {
  user: {
    id: string;
    name: string;
    avatar: string | null;
  };
  mutualIntentCount: number;
  synthesis: string;
}

export function ConnectionCard({ user, mutualIntentCount, synthesis }: ConnectionCardProps) {
  const avatarUrl = user.avatar ?? '';

  return (
    <div className="p-0 mt-0 bg-white border border-b-2 border-gray-800 mb-4">
      <div className="py-4 px-2 sm:px-4">
        {/* User Header */}
        <div className="flex flex-wrap sm:flex-nowrap justify-between items-start mb-4">
          <div className="flex items-center gap-4 w-full sm:w-auto mb-2 sm:mb-0">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={user.name}
                className="rounded-full w-12 h-12"
              />
            ) : (
              <div className="rounded-full w-12 h-12 bg-gray-200" />
            )}
            <div>
              <h2 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">
                {user.name}
              </h2>
              <div className="flex items-center gap-4 text-sm text-gray-500 font-ibm-plex-mono">
                {mutualIntentCount > 0
                  ? `${mutualIntentCount} mutual intent${mutualIntentCount !== 1 ? 's' : ''}`
                  : 'Potential connection'}
              </div>
            </div>
          </div>
        </div>

        {/* Synthesis Section */}
        {synthesis && (
          <div className="mb-2">
            <h3 className="font-medium text-gray-700 mb-2 text-sm">
              What could happen here
            </h3>
            <SynthesisText content={synthesis} />
          </div>
        )}
      </div>
    </div>
  );
}
