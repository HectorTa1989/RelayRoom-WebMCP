import React from 'react';
import { Composition } from 'remotion';
import edit from './data/edit.json';
import { RelayRoomDemo } from './Demo';
import { RelayRoomLinkedIn } from './LinkedIn';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="RelayRoomDemo"
      component={RelayRoomDemo}
      durationInFrames={edit.wide.totalFrames}
      fps={edit.fps}
      width={edit.wide.width}
      height={edit.wide.height}
    />
    <Composition
      id="RelayRoomLinkedIn"
      component={RelayRoomLinkedIn}
      durationInFrames={edit.linkedin.totalFrames}
      fps={edit.fps}
      width={edit.linkedin.width}
      height={edit.linkedin.height}
    />
  </>
);
