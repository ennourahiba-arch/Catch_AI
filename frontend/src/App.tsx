import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Landing from "./pages/Landing";
import StudentDashboard from "./pages/StudentDashboard";
import PracticeCalculus from "./pages/Practice";
import ProfessorDashboard from "./pages/ProfessorDashboard";
import Join from "./pages/Join";
import TeamGame from "./pages/TeamGame";
import HostRoom from "./pages/HostRoom";
import Create from "./pages/Create";
import MyPack, { PackPractice } from "./pages/MyPack";
import NotFound from "./pages/NotFound";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="student" element={<StudentDashboard />} />
        <Route path="practice/:topic" element={<PracticeCalculus />} />
        <Route path="professor" element={<ProfessorDashboard />} />
        <Route path="join" element={<Join />} />
        <Route path="join/:code" element={<Join />} />
        <Route path="class/:code" element={<TeamGame />} />
        <Route path="host/:code" element={<HostRoom />} />
        <Route path="create" element={<Create />} />
        <Route path="mine/:packId" element={<MyPack />} />
        <Route path="mine/:packId/practice" element={<PackPractice />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
