import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Landing from "./pages/Landing";
import StudentDashboard from "./pages/StudentDashboard";
import Practice from "./pages/Practice";
import Play from "./pages/Play";
import ProfessorDashboard from "./pages/ProfessorDashboard";
import NotFound from "./pages/NotFound";
import Join from "./pages/Join";
import TeamGame from "./pages/TeamGame";
import HostRoom from "./pages/HostRoom";
import Train from "./pages/Train";
import Create from "./pages/Create";
import MyPack, { PackOral, PackTrain } from "./pages/MyPack";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="student" element={<StudentDashboard />} />
        <Route path="practice/:topic" element={<Practice />} />
        <Route path="train/:topic" element={<Train />} />
        <Route path="create" element={<Create />} />
        <Route path="mine/:packId" element={<MyPack />} />
        <Route path="mine/:packId/train" element={<PackTrain />} />
        <Route path="mine/:packId/oral/:mode" element={<PackOral />} />
        <Route path="play/:roundId" element={<Play />} />
        <Route path="professor" element={<ProfessorDashboard />} />
        <Route path="join" element={<Join />} />
        <Route path="join/:code" element={<Join />} />
        <Route path="class/:code" element={<TeamGame />} />
        <Route path="host/:code" element={<HostRoom />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
