import { useRoute } from 'preact-iso';
import { Swipe } from '../components/Swipe';
import { Placeholder } from './Placeholder';

// Placeholders until the path, lesson and finale tasks land.
export function PathPage() {
  const { params } = useRoute();
  return (
    <Placeholder title={<>Your <Swipe>path</Swipe></>}>
      <p>The {params.pathId} path is on its way. Soon you'll see every lesson here, and where you left off.</p>
    </Placeholder>
  );
}

export function LessonPage() {
  const { params } = useRoute();
  return (
    <Placeholder title={<>This lesson is <Swipe>nearly ready</Swipe></>}>
      <p>We're still writing “{params.lessonId}”. Check back soon.</p>
    </Placeholder>
  );
}

export function FinalePage() {
  return (
    <Placeholder title={<>You made it <Swipe>this far</Swipe></>}>
      <p>The finale is still being built. It's where you'll find your planted bug and download your record.</p>
    </Placeholder>
  );
}

export function NotFound() {
  return (
    <Placeholder title={<>Nothing <Swipe>here</Swipe></>}>
      <p>That page doesn't exist. Head back and pick a path.</p>
    </Placeholder>
  );
}
